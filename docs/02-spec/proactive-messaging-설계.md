# 선제적(Proactive) 메시징 세부 설계서 (No.35)

> **요구사항**: `docs/requirements/proactive-messaging.md`(T-1~T-7, J-1~J-16, C-1~C-12, FR-0-238~250, FR-PA1-\*~FR-PA9-\*, NFR-PAP/PAS/PAR/PAA/PAM, AC-PA1~PA9, EX-PA-1~19, P-1~P-11)
> **상위 문서**: `docs/02-spec/개발명세서.md` §2·§2.2·§3·§4·§5·§5.1·§6(**결정 46 신설**)·§7 — 반영 문구는 `docs/02-spec/proactive-messaging-patches.md`(찾기/바꾸기 목록)
> **신규 ADR**: **ADR-0045**(선제 안내 = 웹 위젯 안의 규칙 기반 말풍선 · 판정은 브라우저에서만 · 규칙은 기존 설정 조회에 선택 확장 · 수집은 규칙별 일별 숫자만 · 채널 설정 스키마 불변 · 엔진 변경 0). `decisions/`의 현재 최대 번호는 0043 → 0044(No.43)이고, 보류 초안 두 건(`plugin-marketplace.md`·`connector-hub.md` — 미커밋)이 0045를 가번호로 적었지만 **이 그룹이 실제로 구현될 첫 새 기능이므로 0045를 쓴다**. 보류 초안은 재개 시 다음 빈 번호를 새로 잡는다(ADR-0045 §12).
> **갱신 ADR(각주만 — 개발명세서 §6)**: ADR-0009(트리거 미발동 기록) · ADR-0011(공개 표면 9 · 설정 조회 선택 확장) · ADR-0012(위젯 — Preact 트리거 미발동 · 서브패스 +1) · ADR-0038(전용 버킷 kind +2 · 기능 선언 추가 0) · ADR-0040(데이터 지도 선택 키 · 출구·보존·암호화 0) · ADR-0041(135행 트리거 미이행 — 규모 B) · ADR-0042(식별 용도 불변)
> **작성일**: 2026-09-29 · **GPU**: **1**(카탈로그 3 → 1 — P-10) · 구축형 ○ · 구독형 ○
> **표기**: 봉인 **PA-1~PA-18** · 의도된 기존 시험 기대값 변경 **X-1~X-7**(닫힌 목록 — FR-0-249) · 요구사항 대비 해석 **R-1~R-20** · 알려진 제한 **K-1~K-16** · 구현 편차는 구현 후 §24에 **I-n**으로 기록

---

## 0. 이 문서가 푸는 문제 (한 문단 요약)

지금 위젯은 방문자가 런처를 눌러야만 서버에 설정을 묻고 대화를 시작한다(`apps/widget/src/ui/app.ts` 413~434행). 사용자는 2026-09-29에 **규모 A · 트리거 "페이지 머묾" 1종 · 닫음 기억은 탭 세션 · 측정은 숫자만 · 말풍선만 · 이용 도움 안내 한정**을 확정했다. 이 설계는 **기능을 쓰지 않는 챗봇·사이트·구버전 위젯의 요청과 응답을 한 바이트도 바꾸지 않고** 다음을 만든다. ① 사이트 삽입 코드에 `data-proactive="on"`이 있는 페이지에서만 위젯이 **기존 설정 조회에 `?proactive=1`을 붙여 1회** 규칙을 받는다(새 조회 경로 0) ② 위젯이 **브라우저 안에서만** "이 경로에 탭이 보이는 상태로 N초 머물렀나"를 판정해 런처 옆에 **말풍선**을 띄운다(포커스·스크롤 이동 0 · 자동 열기 0 · 패널 밖 알림 1회) ③ 말풍선 버튼을 누르면 **기존 버튼 처리 그대로** 창이 열리고 평범한 `NODE`/`MESSAGE` 턴이 간다(엔진·대화 경로 변경 0) ④ 표시·클릭·닫기·끄기를 **수집 경로 1개**(`@Public()` 8 → 9)로 받아 **규칙·일별 숫자만** 올린다(세션·주소·IP 저장 0) ⑤ 규칙·스위치·집계는 **새 테이블 3개**(마이그레이션 = `CREATE`만)에 두고 `WebChannelConfigSchema`는 건드리지 않는다 ⑥ 콘솔에서 규칙을 만들고(광고 아님 확인 필수 · 감사) 켜고 끄고 순서를 바꾸고 통계를 본다.

> 이 설계가 코드에서 **추가로 찾은 제약 12건**(요구사항 C-1~C-12 외):
> **① `WebChannelConfigSchema`는 `.strict()`이고 서버는 파싱 실패 시 기본값으로 폴백한다**(`apps/api/src/channels/lib/channel-config.ts` 8~18행) → 새 키를 저장한 뒤 구버전 서버로 롤백하면 WEB 설정이 통째로 기본값이 되고 **`allowedOrigins = []` → Origin 가드가 모든 출처를 허용**한다(`conversation/lib/origin-match.ts` 16행 · `public-origin.guard.ts` 44~50행). → 스키마에 키를 더하지 않는다(ADR-0045 §1 · EX-PA-18 해소) ·
> **② `@PublicRateBucket()`은 핸들러 단위 정적 메타데이터**다(`common/rate-limit/public-rate-bucket.decorator.ts` 23행 · `public-rate-limit.guard.ts` 43~50행) → 같은 `getConfig` 핸들러에서 선제 조회만 다른 버킷을 쓰려면 **조건부(`when`) 명세**가 필요하다(§5.4) ·
> **③ `getConfig`의 `@Header('Cache-Control', 'no-store')`도 정적**이다(`public-conversation.controller.ts` 46행) → 쿼리별 캐시 헤더는 비용이 크다 — 캐시를 두지 않는다(§5.5) ·
> **④ `environment-sealing.spec.ts` E-9가 `public-conversation.service.ts` 안의 `bundleSourceOf(`·`.getCached(`·`versionBundles.get(`을 각 정확히 1회로 봉인**한다(321~328행) → 노드 유효성 판정은 기존 `loadServing()`을 **클로저로 넘겨** 쓴다(§5.2) ·
> **⑤ 공개 대화 경로는 허용 도메인 표(`ChatbotRichUrlPolicy`)를 읽지 않는다**(ADR-0043 §7 · `rich-url-policy.service.ts` 11~13행) → `LINK` 주소는 저장 시점에만 검사한다(K-8) ·
> **⑥ 위젯의 `fetch`는 브라우저 기본 리퍼러 정책**을 따른다 — 같은 출처 배포(구축형에서 흔함)면 **페이지 전체 주소가 `Referer`로 간다** → 선제 요청 2종은 `referrerPolicy: 'no-referrer'`(§8 · PA-12) ·
> **⑦ `app.ts`는 이미 `visibilitychange` 리스너 1개를 무조건 등록**한다(235행 — 상담 폴링용) → AC-PA1-6의 "리스너가 도입 전과 같다"는 **추가 리스너 0**으로 판정한다 ·
> **⑧ 런처 위치(`LEFT`)·숨김(`showLauncher=false`)은 첫 열기 때 `applySkin()`에서야 반영**된다(427행 · 389~394행) → 말풍선 위치 기준이 흔들리므로 선제 조회 성공 시 `applySkin()`을 **앞당겨** 호출한다(선제 안내를 켠 사이트만 — §6.1) ·
> **⑨ 가드는 파이프보다 먼저 실행되지만 본문은 이미 파싱돼 있다**(기존 `session` 버킷이 `req.body.sessionId`를 읽음 — 63~64행) → 수집 경로의 세션 키 버킷을 **본문 키**로 만들 수 있다 ·
> **⑩ 엔진은 켜진 노드면 직전 제시 여부와 무관하게 실행하고, 없거나 꺼지면 폴백한다**(`resolver.ts` 817~819 · 861~867행) → 공개 조회 시점에 서비스 중 번들로 노드를 검사해 **규칙 전체를 뺀다**(§10) ·
> **⑪ `@Public()` 개수 8을 단언하는 시험이 6개 파일**이다(`public-decorator-count.spec.ts` · `feedback-sealing.spec.ts` F-6 · `deploy-schedule-sealing.spec.ts` D-5 · `handoff-sealing.spec.ts` H-10 · `validation-sealing.spec.ts` 7) · `version-sealing.spec.ts` V-8) → 닫힌 목록 X-1~X-6(§16.3). 새 핸들러는 컨트롤러 **맨 끝**에 둔다(H-10·F-6의 "핸들러 앞 N자" 창 검사 보존) ·
> **⑫ `environment-sealing.spec.ts` E-10이 `apps/widget/src`에 `environment` 토큰(대소문자 무시)을 금지**한다(469~492행) → 위젯 선제 코드에 이 단어를 쓰지 않는다(식별자·문자열 모두 — 주석 제외).

---

## 1. PM 확정 사항 (2026-09-29 — 사용자 결정)

| # | 확정 내용 | 요구사항 추천안과의 관계 | 이 문서 반영 |
|---|---|---|---|
| **P-1** | **(A) 웹 위젯 · 규칙 기반** — 서버 이벤트·식별 고객·예약 캠페인(B)·외부 채널 발송(C) 하지 않음 | 추천안 | 전체 |
| **P-2** | **페이지 머묾(`PAGE_DWELL`) 1종만** — 사이트 신호(`HOST_SIGNAL`)·대화 중 연속 미응답(`UNANSWERED_STREAK`)은 이번에 구현하지 않음. 설계는 확장 여지만 남김 | **추천 (a)에서 축소 = (c)** | §4.1 · §22 |
| **P-3** | **(a) 탭 세션 동안만 기억**(`sessionStorage`) · 버튼 문구 "이번 방문 동안 안내 끄기" | 추천안 | §6.6 |
| **P-4** | **(a) 표시·클릭·닫기(+끄기) 수만** — 누가 봤는지 기록 안 함 · 공개 경로 +1 | 추천안 | §5.3 · §11 |
| **P-5** | **(a) 말풍선만** · 자동 열기 없음 · 휴대폰은 규칙별 선택(기본 꺼짐) | 추천안 | §6.4 |
| **P-6** | **(a) 이용 도움 안내로 한정** · 저장 시 "광고 목적 아님" 확인 필수 · 감사 기록 | 추천안 | §9.3 · §12 |
| P-7~P-11 | 권한 신규 0 · 환경·스냅샷 밖 + 서비스 중 번들에 노드 없으면 제외 · 삽입 속성 있을 때만 조회 · GPU 1 · §9 범위 | 추천안 | §10 · §12 · §23 |
| (architect) | ADR 번호 = **0045** · 보류 초안은 재개 시 다음 빈 번호 | — | ADR-0045 §12 |
| (architect) | 스위치 저장 = **1:1 새 테이블**(`WebChannelConfigSchema` 불변) | 요구사항 §5.1 선택지 중 후자 | §3 · ADR §1 |
| (architect) | 규칙 조회 = **기존 설정 조회 `?proactive=1` 선택 확장**(새 `@Public()` 0) · 수집 = 새 경로 1 | FR-0-243 권고와 일치 | §5 |
| (architect) | 전용 버킷 `PROACTIVE_RULES`·`PROACTIVE_EVENT` · 설정 조회는 조건부 버킷 | FR-PA5-5 | §5.4 |
| (architect) | 캐시 **없음**(`no-store` 유지) | FR-PA5-8 "값은 architect" → 0초 | §5.5 |
| (architect) | 위젯 기능 선언 **추가 0**(3/5 유지 — `proactive-v1`은 연속 미응답 도입 시) | C-10 여유 확인 | §6.9 |
| (architect) | 노드 삭제는 **막지 않고** 경고(콘솔 계산 — 대화 설계 API 변경 0) | EX-PA-4 | §10 |
| (architect) | 순서 = `position`(작을수록 우선 · 위/아래 이동) | FR-PA1-2 "우선순위 정수"의 등가 표현 | R-3 |
| (architect) | 감사 대상 +1 `ProactiveRule` · 스위치는 `UPDATE Chatbot` · 보존 종류·출구·암호화 추가 0 | FR-0-248 · FR-PA7-3 | §12 |
| (architect) | 기대값 변경 닫힌 목록 X-1~X-7 · 봉인 PA-1~PA-18 | FR-0-249 | §14 · §16.3 |

### 1.1 이번 범위에서 빠진 요구사항 항목 (P-2 축소의 결과)

`FR-PA2-4`(사이트 신호) · `FR-PA2-5~7`(연속 미응답) · `FR-PA2-8`(스크롤·이탈 — 원래 선택) · `FR-PA3-8`(대화 창 안 제안 표식) · `FR-PA4-6`의 서버 측 억제(위젯 측 억제는 구현) · `FR-PA6-1` 후단(연속 미응답 카운트) · `FR-PA9-5`(시뮬레이터 제안) · `NFR-PAP2` · `NFR-PAS5` · `AC-PA3-4` · `AC-PA4-3`의 제안 부분 · `AC-PA4-8` · `AC-PA5-7` · `AC-PA5-8` · `EX-PA-13` · `EX-PA-15` · `EX-PA-19`. **`AC-PA1-3`은 오히려 자동 충족**된다 — 메시지 요청·응답 경로를 이 그룹이 바꾸지 않는다(그래도 회귀 시험은 둔다 — §16).

---

## 2. 아키텍처 배치

### 2.1 파일 구조 (신규 · 주요 수정)

```
packages/shared-types/src/
├── proactive.ts            # [신규] 규칙·설정·공개 페이로드·수집 사건·통계·목록 zod 계약 · PROACTIVE_LIMITS · 트리거 판별 유니온(1차 PAGE_DWELL)
│                           #        · findProactiveRulesReferencingNode(rules, nodeId)(콘솔 노드 삭제 경고용 순수 함수)
├── proactive-eval.ts       # [신규 · zod 무의존 · 서브패스] 경로 정규화·패턴 매칭(정규식 0) · 표시 게이트 · 후보 선택 — 위젯·콘솔 공용 1벌
├── audit.ts                # [수정] AuditTargetType +ProactiveRule(34 → 35) · 라벨 '선제 안내'
├── governance.ts           # [수정] GovernanceMapResponseSchema 선택 키 proactive?
└── index.ts                # [수정] export proactive(※ proactive-eval은 index에서 재수출하되 위젯은 서브패스로만 import)
packages/shared-types/package.json   # [수정] exports +"./proactive-eval"
apps/api/src/
├── proactive/                                   # ── 신규 모듈 ──
│   ├── proactive.module.ts                      # controllers [ProactiveController] · exports [ProactivePublicService] 1개
│   ├── proactive.controller.ts                  # /chatbots/:chatbotId/proactive — 10 핸들러
│   ├── proactive-settings.service.ts            # ★ ChatbotProactiveSetting 쓰기 유일 · 감사(UPDATE Chatbot)
│   ├── proactive-rules.service.ts               # ★ ProactiveRule 쓰기 유일 · 저장 검증(노드·금지어·허용 도메인·상한·이름) · 감사
│   ├── proactive-overview.service.ts            # 목록(규칙 + 문제 + 최근 7일) · 통계 조회(읽기 전용)
│   ├── proactive-target-check.service.ts        # 관리 화면용 "서비스 중 번들" 노드 켜짐 조회(bundleSourceOf + DialogueBundleService/VersionBundleService)
│   ├── public/
│   │   └── proactive-public.service.ts          # 공개 페이로드 조립(필터·showUntil) · 수집 사건 처리(결합 검증 → 중복 억제 → 증가) — export 유일
│   ├── core/
│   │   ├── proactive-stat.writer.ts             # ★ ProactiveDailyStat 쓰기 유일(upsert + increment · P2002 1회 재시도)
│   │   └── proactive-event-deduper.ts           # 메모리 중복 억제(해시 키 · 상한 50,000 · TTL 24시간)
│   └── lib/                                     # 순수 — DB·Nest·시계 무의존(시각은 인자)
│       ├── rule-codec.ts                        # 행 ↔ DTO(JSON 컬럼 안전 파싱 — 불량이면 규칙 무효 취급)
│       ├── rule-servability.ts                  # 규칙 문제 판정 1벌(노드·금지어·허용 도메인) — 공개 필터·관리 목록 공용
│       ├── schedule-window.ts                   # 게시 기간·표시 시간대(KST) 판정 · showUntil 계산
│       ├── stats-aggregate.ts                   # 합계·비율(분자 ≤ 분모 상한)·"자주 닫힘" 판정
│       ├── rule-audit-summary.ts                # 바뀐 항목 이름 목록(문구 원문 0)
│       ├── contact-like.ts                      # 전화·이메일처럼 보이는 문자열 경고(차단 아님)
│       └── proactive-sealing.spec.ts            # §14 PA-1~PA-18(서버·공유 부분)
├── conversation/public-conversation.controller.ts   # [수정] getConfig: @Query('proactive') + 조건부 @PublicRateBucket · 맨 끝 recordProactiveEvent(@Public 9번째)
├── conversation/public-conversation.service.ts      # [수정] getConfig(slug, opts?) 선택 분기 · recordProactiveEvent(slug, dto) 신설 · 19번째 선택 생성자 인자
├── conversation/conversation.module.ts              # [수정] imports +ProactiveModule
├── common/rate-limit/public-rate-bucket.decorator.ts # [수정] kind +2 · key 선택 · key.from +'body' · when?
├── conversation/guards/public-rate-limit.guard.ts   # [수정] when 판정 · key 없음 = IP축만 · body 키 · BUCKET_SPEC_BY_KIND +2행
├── config/env.validation.ts                         # [수정] 선택 4종
├── chatbots/chatbots.service.ts                     # [수정] 영구삭제 동반 삭제 +3(24 → 27테이블)
├── audit-logs/lib/audit-snapshot.ts                 # [수정] AUDIT_FIELDS.ProactiveRule 신설 · AUDIT_FIELDS.Chatbot +'proactive'
├── governance/governance-map.service.ts             # [수정] 선택 키 proactive?(규칙 ≥1 또는 켜진 스위치 ≥1일 때만 — 쿼리 +2)
└── app.module.ts                                    # [수정] imports 끝 ProactiveModule(ConversationModule도 import — 중복 무해)
apps/api/prisma/schema.prisma + migrations/20260929120000_proactive_messaging/   # 모델 3 신규(파일 끝) · Chatbot 역참조 3줄
apps/widget/src/
├── loader.ts                    # [수정] data-proactive 읽기 → createWidgetApp 옵션 proactive
├── ui/app.ts                    # [수정] 옵션 proactive?: boolean · 선제 컨트롤러 조립(조건부) · handleOpen/handleSend에 선택 훅 2줄
├── api/public-client.ts         # [수정] getConfigForProactive() · sendProactiveEvent() — 둘 다 referrerPolicy:'no-referrer'
├── core/proactive-storage.ts    # [신규] sessionStorage cb.pa.{slug} 기록(메모리 폴백 — session.ts 방식)
├── core/proactive-controller.ts # [신규] 조회 → 틱(1초·가시성·경로 비교) → 게이트 → 표시 → 사건 전송(의존성 주입 — 시험 가능)
├── ui/proactive-bubble.ts       # [신규] 말풍선 DOM + 패널 밖 role=status 알림 영역
├── constants/proactive.ts       # [신규] 속성 값·저장 키·틱·문구
├── styles.ts                    # [수정] 말풍선 스타일 · prefers-reduced-motion
└── (spec) core/proactive-*.spec.ts · ui/proactive-bubble.spec.ts · ui/app.proactive.spec.ts · core/proactive-sealing.spec.ts
apps/widget/vite.config.ts       # [수정] optimizeDeps.include +'@chat-bot/shared-types/proactive-eval'(시험·개발 서버)
apps/web/src/                    # §13(ui-designer → frontend-implementer)
```

### 2.2 모듈 의존 방향

```
proactive  → chatbots(ChatbotScopeService) · audit-logs · banned-words(BannedWordFilterService)
             · dialogue-common(DialogueBundleService) · environment/serving(VersionBundleService) · prisma · config
conversation → proactive(ProactivePublicService — export 유일)
governance → Prisma 읽기(chatbotProactiveSetting·proactiveRule count) — proactive 모듈 import 0
engine · ml-worker · 채널 어댑터 → proactive 심볼 0(PA-1)
```

- `ProactiveModule`의 export는 **`ProactivePublicService` 1개**다. 공개 대화의 DI 그래프에는 "페이로드 조립·사건 처리" 경로만 있고 규칙·설정 **쓰기** 경로가 없다(쓰기 서비스는 export하지 않음).
- `proactive`는 `conversation`을 import하지 않는다 — 슬러그 → 챗봇 판정(`PublicAccessService`)은 `conversation`이 하고 행을 넘긴다(순환 없음).
- `ProactivePublicService`는 **`ChatbotRichUrlPolicy`·식별(`inbox/**`)·상담(`handoff/**`)·엔진 패키지를 import하지 않는다**(PA-9).

### 2.3 실행 흐름

```
■ 방문자 페이지 로드 (삽입 코드에 data-proactive="on" · 전체 화면 아님)
  loader → createWidgetApp({ ..., proactive: true })
  → client.getConfigForProactive()        GET /public/chatbots/:slug/config?proactive=1   (no-referrer)
       서버: 가드(pa-rules-ip) → Origin → access.resolve → 기존 설정 객체 조립
             → ProactivePublicService.buildPayload(chatbot, now, loadServing 클로저)
                 PROACTIVE_ENABLED? → 설정 행(켜짐?) → 켜진 규칙 ≤10(position 순)
                 → 트리거 종류 ∈ 위젯 판정 가능 목록 → 게시 기간·표시 시간대(KST) → 금지어 → NODE 버튼 노드 켜짐(서비스 중 번들)
                 → { caps, rules[] }   (실패·꺼짐 = rules: [])
       응답: { ...기존 8키, proactive }
  → applySkin(config) 앞당김 · 런처 숨김이면 종료(EX-PA-7) · rules 0이면 종료(타이머·리스너 0)
  → 틱 시작(1초 · 탭 보일 때만) — 매 틱: 경로 비교(SPA) → 누적 체류 → 후보 선택 → 게이트
       게이트 통과 → 말풍선 표시 + 패널 밖 알림 1회 + sessionStorage 기록 + SHOWN 전송(keepalive · 결과 무시)
  ├ 버튼 NODE/MESSAGE → CLICKED 전송 → handleOpen() 완료 후 기존 handleButtonAction(view)  → 평범한 턴 → 로그 1행(현행)
  ├ 버튼 LINK         → CLICKED 전송 → 새 탭(noopener,noreferrer) · 창 열지 않음
  ├ 버튼 0개 규칙 본문 → CLICKED 전송 → handleOpen()(턴 없음 — 인사말만)
  ├ × 안내 닫기(또는 Esc) → DISMISSED 전송 → 이 규칙 이 탭에서 다시 안 뜸 → 포커스가 말풍선 안이었으면 런처로
  ├ 이번 방문 동안 안내 끄기 → OPTED_OUT 전송 → 이 탭 모든 선제 안내 중지(틱·리스너 해제)
  └ 런처로 창 열기 → 말풍선 숨김(사건 없음) · 이 규칙 이 탭에서 다시 안 뜸

■ 수집   POST /public/chatbots/:slug/proactive-events  { sessionId, ruleId, kind }  (no-referrer · keepalive)
  가드(pa-ev-ip + pa-ev-key:session) → Origin → zod strict(400) → 중복 억제 조회(메모리 — 있으면 204)
  → access.resolve(404/403 — 기존 규약) → 서버 스위치·설정 켜짐·규칙(같은 챗봇·켜짐·위젯 판정 종류) 결합 검증(불일치 = 204)
  → 중복 억제 등록 → ProactiveDailyStat(ruleId, KST 오늘) +1 (실패는 경고 로그만) → 204
```

### 2.4 워크스페이스 영향

| 워크스페이스 | 변경 |
|---|---|
| `packages/dialogue-engine` | **0** |
| `packages/shared-types` | §4(신규 2파일 · 수정 3 · 서브패스 +1) |
| `packages/pii-mask` | 0 |
| `apps/api` | 신규 모듈 1(관리 컨트롤러 1 · 핸들러 10) · 공개 핸들러 +1 · 테이블 3 · 마이그레이션 1(`CREATE`만) · §2.5 |
| `apps/widget` | 선제 컨트롤러·말풍선·저장·클라이언트 2메서드 · 로더 속성 1 |
| `apps/web` | §13 |
| `apps/ml-worker` | **0** |

### 2.5 기존 코드 변경 목록 (구현자 체크리스트)

| 파일 | 변경 | 근거 |
|---|---|---|
| `prisma/schema.prisma` + `20260929120000_proactive_messaging` | 모델 3 신규(파일 끝) · `Chatbot` 역참조 3줄(DB 변화 0) · 기존 모델 컬럼 변경 0 | §3 |
| `packages/shared-types/src/{proactive(신규), proactive-eval(신규), audit, governance, index}.ts` · `package.json` | §4 | — |
| `conversation/public-conversation.controller.ts` | `getConfig`: `@Query('proactive') proactive?: string` 추가 · `@PublicRateBucket({ kind: 'PROACTIVE_RULES', when: { query: 'proactive', equals: '1' } })` · 호출은 `proactive === '1' ? getConfig(slug, { proactive: true }) : getConfig(slug)` · **맨 끝** `@Post('proactive-events') @Public() @HttpCode(204) @Header('Cache-Control','no-store') @PublicRateBucket({ kind: 'PROACTIVE_EVENT', key: { from: 'body', name: 'sessionId', ns: 'session' }, perKeyLimit: { env: 'PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_SESSION_PER_MIN', fallback: 20 } }) recordProactiveEvent(...)` · 클래스 주석 "8곳" → "9곳" | §5 |
| `conversation/public-conversation.service.ts` | `getConfig(slug, opts?)` — `opts?.proactive`가 아니면 **기존 객체 그대로 반환**(분기는 반환 직전 1곳) · `recordProactiveEvent(slug, dto)` 신설(access.resolve → 위임) · 19번째 **선택** 생성자 인자 `proactivePublic?: ProactivePublicService` · `sendMessage`·`pollMessage` 무변경 | §5.1 · §5.3 |
| `conversation/conversation.module.ts` | imports +`ProactiveModule` | §2.2 |
| `common/rate-limit/public-rate-bucket.decorator.ts` | `kind` +`'PROACTIVE_RULES'｜'PROACTIVE_EVENT'` · `key?` · `key.from` +`'body'` · `perKeyLimit?` · `when?: { query: string; equals: string }` | §5.4 |
| `conversation/guards/public-rate-limit.guard.ts` | `bucketSpec && matchesWhen(req, bucketSpec)`일 때만 전용 버킷 · `key` 없으면 IP축만 · `from:'body'` = `req.body?.[name]`(문자열만) · 표 +2행(`pa-rules-ip`/`pa-rules-key` · `pa-ev-ip`/`pa-ev-key`) · `POLL`·`FEEDBACK` 행 바이트 불변 | §5.4 |
| `config/env.validation.ts` | `PROACTIVE_ENABLED: envBoolean(true)` · 버킷 한도 3종 | §3.5 |
| `chatbots/chatbots.service.ts` | 영구삭제 트랜잭션에 `proactiveDailyStat`·`proactiveRule`·`chatbotProactiveSetting` `deleteMany` 3줄(`chatbot.delete` 직전 · 24 → 27) — 사전검사 409 대상 아님(설정·통계) | §3.3 |
| `audit-logs/lib/audit-snapshot.ts` | `AUDIT_FIELDS.ProactiveRule` · `AUDIT_FIELDS.Chatbot`에 `'proactive'` | §12 |
| `governance/governance-map.service.ts` | 선택 키 `proactive?` 조립(규칙 ≥1 ∨ 켜진 스위치 ≥1) | §12.3 |
| `app.module.ts` | imports 끝 `ProactiveModule` | §2.2 |
| `apps/widget/src/{loader, ui/app, api/public-client, styles}.ts` + 신규 4 | §6 | — |
| `apps/widget/vite.config.ts` | `optimizeDeps.include` +서브패스 | §4.2 |
| `apps/web/src/*` | §13 | — |
| 시험 파일 | §16.3 X-1~X-7 + 신규 | FR-0-249 |

> **이 목록에 없는 파일은 바꾸지 않는다.** 특히 `packages/dialogue-engine/**` · `apps/ml-worker/**` · `apps/api/src/conversation/adapters/**` · `packages/shared-types/src/channel.ts`(`WebChannelConfigSchema`) · `packages/shared-types/src/conversation.ts`(공개 요청·응답 스키마 · 기능 선언 상수) · `channels/**` · `dialog-nodes/**` · `dialogue-common/reference-check.service.ts` · `handoff/**` · `inbox/**` · `rich-messages/**` · `versions/**` · `environment/**` · `deploy-schedules/**` · `asset-transfer/**` · `stats/**` · `apps/widget/src/core/session.ts` · `apps/widget/src/api/public-client.ts`의 `sendMessage` 기능 선언 배열.

### 2.6 커밋 분리 단위

| 커밋 | 범위 | 독립성 · 게이트 |
|---|---|---|
| **① 계약·순수 함수·골든(관측 불변)** | shared-types `proactive.ts`·`proactive-eval.ts`(+ 단위 시험 · 서브패스) · `audit.ts`(+`ProactiveRule`) · `governance.ts`(선택 키) · **도입 전 `GET …/config` 응답 본문 골든 캡처 픽스처**(seed 챗봇 · 서버 코드 변경 전에 캡처) · 웹 타입 망라 컴파일(감사 라벨은 shared-types 상수) | 관측 변화 0 · 기존 시험 무수정 통과 |
| **② 서버** | 마이그레이션·스키마 · `proactive` 모듈 전부 · 버킷 명세·가드 확장 · 설정 조회 확장 · 수집 핸들러 · 환경변수 · 영구삭제 +3 · 감사 화이트리스트 · 데이터 지도 · 봉인(서버) | **X-1~X-7** 전부 이 커밋. 골든 시험(①의 픽스처)으로 쿼리 없는 조회 바이트 동일 확인 |
| **③ 위젯** | 로더 속성 · 컨트롤러 · 말풍선 · 저장 · 클라이언트 · 스타일 · 위젯 봉인 · 번들 크기 측정 | 기대값 변경 0 · `check-bundle-size.mjs` 통과 + 증가분 기록 |
| **④ 콘솔·문서** | 선제 안내 화면 · 노드 삭제 경고 · 데이터 지도 절 · `docs/05-ops` 삽입 안내 · `UIUX_준수기준.md` 패턴(ui-designer 제안 반영) | 기대값 변경 0(탭 추가 방식이면 §13 주의) |

---

## 3. 데이터 모델 · 마이그레이션

### 3.1 Prisma 변경안 (파일 끝에 추가 · 기존 모델은 역참조만)

```prisma
// model Chatbot { ... } 안 — 역참조만(DB 컬럼 변화 0)
  /// [신규 No.35] 선제 안내 설정·규칙·집계(환경 밖 · 스냅샷·복사·토픽 분리 대상 아님 · 영구삭제 동반 삭제). 컬럼 추가 0.
  proactiveSetting        ChatbotProactiveSetting?
  proactiveRules          ProactiveRule[]
  proactiveDailyStats     ProactiveDailyStat[]

/// [신규 No.35] 챗봇별 선제 안내 설정(1:1 · 행 없음 = 꺼짐 — ADR-0045 §1). 환경 밖(저장 즉시 반영 · 캐시 없음).
/// ★ 쓰기 = proactive/proactive-settings.service.ts 1파일(+ chatbots.service.ts 동반 삭제 deleteMany) — PA-2.
model ChatbotProactiveSetting {
  chatbotId                 String   @id
  chatbot                   Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  enabled                   Boolean  @default(false)
  /// 세션(탭)당 최대 표시 수 1~3
  maxPerSession             Int      @default(1)
  /// 안내 사이 최소 간격(초) 30~600
  minIntervalSec            Int      @default(60)
  /// 사용자가 메시지를 보낸 뒤 조용히 있는 시간(초) 60~1800 — FR-PA4-5
  quietAfterUserMessageSec  Int      @default(300)
  /// 마지막 변경자(FK 없음 — 사실 기록)
  updatedById               String?
  createdAt                 DateTime @default(now())
  updatedAt                 DateTime @updatedAt

  @@map("chatbot_proactive_settings")
}

/// [신규 No.35] 선제 안내 규칙(챗봇 소속). ★ 쓰기 = proactive/proactive-rules.service.ts 1파일(+ 동반 삭제) — PA-2.
/// 문구·버튼은 관리자 작성 텍스트(방문자 개인정보 0). 노드 참조는 buttons JSON 안(FK 없음 — 조회 시점 판정).
model ProactiveRule {
  id                    String    @id @default(uuid())
  chatbotId             String
  chatbot               Chatbot   @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name                  String
  /// normalizeText(name) — ADR-0006
  nameNormalized        String
  enabled               Boolean   @default(false)
  /// 작을수록 우선(위/아래 이동 · 동점은 createdAt, id)
  position              Int
  /// 'PAGE_DWELL'(1차 유일) — 판별 유니온 kind 사본(인덱스·필터용)
  triggerKind           String
  /// JSON ProactiveTrigger(kind 포함)
  trigger               String
  text                  String
  /// JSON ProactiveButton[](0~3 · { label, action: NODE|MESSAGE|LINK, value })
  buttons               String    @default("[]")
  /// JSON ('DESKTOP'|'MOBILE')[]
  devices               String    @default("[\"DESKTOP\"]")
  startsAt              DateTime?
  endsAt                DateTime?
  /// JSON { days: number[](0=월~6=일 — toKstWeekday), from: 'HH:mm', to: 'HH:mm' } | null (KST)
  schedule              String?
  /// "광고·판촉 목적 아님" 확인(저장마다 갱신 — 필수)
  purposeConfirmedAt    DateTime
  purposeConfirmedById  String?
  createdById           String?
  updatedById           String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, enabled, position])
  @@map("proactive_rules")
}

/// [신규 No.35] 규칙 × KST 일 집계(ADR-0045 §1). ★ 세션·IP·주소·리퍼러·UA·시각 원본 컬럼 없음(PA-3).
/// ruleId는 FK 없음 — 규칙 삭제 후에도 이름 스냅샷과 함께 남는다(FR-PA6-5). ★ 쓰기 = core/proactive-stat.writer.ts 1파일(+ 동반 삭제).
model ProactiveDailyStat {
  id         String   @id @default(uuid())
  chatbotId  String
  chatbot    Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  ruleId     String
  /// 마지막 증가 시점의 규칙 이름
  ruleName   String
  /// KST 'YYYY-MM-DD'(toKstDayBucket)
  dayBucket  String
  shown      Int      @default(0)
  clicked    Int      @default(0)
  dismissed  Int      @default(0)
  optedOut   Int      @default(0)
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  @@unique([ruleId, dayBucket])
  @@index([chatbotId, dayBucket])
  @@map("proactive_daily_stats")
}
```

### 3.2 마이그레이션 (1개 — `20260929120000_proactive_messaging`)

- `CREATE TABLE` 3 + `CREATE UNIQUE INDEX` 2 + `CREATE INDEX` 2 + FK 3(→ `chatbots`). **`ALTER TABLE`·`DROP`·기존 테이블 재정의 0**(No.43 교훈 — SQLite 재정의는 부분 인덱스를 잃을 수 있다). 부분 유니크 인덱스 추가 0 → `rich-message-sealing.spec.ts` RM-12(적용 DB 부분 인덱스 = 4) 불변.
- 백필 0 · seed 변경 0(데모 규칙을 만들지 않는다 — 켜면 데모 사이트에서 말풍선이 뜬다. seed는 선택 사항으로 **꺼진** 예시 규칙 1건만 허용 — 구현자 재량, 만들면 스위치는 꺼짐).
- 롤백 = 세 테이블 DROP. 구버전 서버는 세 테이블을 모르므로 **남아 있어도 동작에 영향 없다**(롤백 시 WEB 설정·Origin 가드 무영향 — ADR-0045 §1의 핵심 이득).

### 3.3 기존 데이터 호환성

| 대상 | 영향 |
|---|---|
| `channels.config`(WEB JSON) | **변경 0** — 구·신 서버 모두 같은 스키마로 읽는다 |
| `chatbots` | 컬럼 0 변경 · 영구삭제 동반 삭제 24 → 27테이블(설정 데이터·통계 — 사전검사 409 대상 아님) |
| `conversation_logs` | 0 — 말풍선 표시는 로그를 만들지 않는다(PA-14 · AC-PA1-7) |
| 버전 스냅샷(`ChatbotVersionPayload`) | 0 — 규칙은 스냅샷 밖(`contentHash` 불변) |
| 감사 로그 | 새 `targetType` 값 `ProactiveRule`만 추가(기존 행 무영향 · 체인 무영향) |

### 3.4 거버넌스 편입

- 보존 종류 추가 **0** — 규칙은 관리자 설정, 집계는 개인정보 없는 숫자다. 챗봇 영구삭제 시 동반 삭제(그 외 파기 없음). 재검토: 보존 정책에 "통계 N일" 요구가 생기면 `CALL_LOGS`가 아니라 새 종류로.
- 암호화 대상 추가 **0** · 외부 출구 추가 **0**(`EgressExitId` 7 불변 — 서버는 송신하지 않는다).
- 데이터 지도 선택 키 `proactive?` — §12.3.

### 3.5 환경변수 (전부 선택 · API 전용)

| 이름 | 기본값 | 뜻 |
|---|---|---|
| **`PROACTIVE_ENABLED`** | `true` | 서버 전체 스위치(`envBoolean()`). `false` = 공개 조회의 `rules: []` · 수집 무시(204) · 관리 API는 동작(콘솔에 "서버에서 꺼짐" 표시 — 응답 `serverEnabled`) |
| **`PUBLIC_PROACTIVE_RULES_RATE_LIMIT_IP_PER_MIN`** | `300` | 선제 조회 전용 IP 버킷(`pa-rules-ip`) — 대화 `ip` 버킷 비소비 |
| **`PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_IP_PER_MIN`** | `300` | 수집 전용 IP 버킷(`pa-ev-ip`) |
| **`PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_SESSION_PER_MIN`** | `20` | 수집 세션 키 버킷(`pa-ev-key:session:{sessionId}`) |

- 새 백그라운드 루프 **0** → `jest.isolate-env.js` 변경 0. `PROACTIVE_ENABLED=false` 시험은 동적 import(`CLAUDE.md` 규약).
- 규칙 상한(20/10)·문구 길이·중복 억제 상한·통계 기간 상한은 코드 상수 `PROACTIVE_LIMITS`(FE/BE 공용).

---

## 4. shared-types 계약

### 4.1 `packages/shared-types/src/proactive.ts` (zod — 서버·콘솔 공용)

| 심볼 | 내용 |
|---|---|
| `PROACTIVE_LIMITS` | `rulesMax 20 · enabledRulesMax 10 · nameMax 40 · textMax 120 · textMaxNewlines 2 · buttonsMax 3 · buttonLabelMax 20 · messageTextMax 200 · pathPatternsIncludeMax 10 · pathPatternsExcludeMax 10 · pathPatternMax 200 · pathPatternDoubleStarMax 2 · dwellSecMin 5 · dwellSecMax 600 · dwellSecDefault 30 · maxPerSession 1~3(기본 1) · minIntervalSec 30~600(기본 60) · quietAfterUserMessageSec 60~1800(기본 300) · statsRangeDaysMax 90 · statsRangeDaysDefault 7 · frequentDismiss { ratio: 0.5, minShown: 100 }` |
| `ProactiveTriggerKind` | `z.enum(['PAGE_DWELL'])` — **1차 1값**. 2차 값(`HOST_SIGNAL`·`UNANSWERED_STREAK`)은 추가 시 enum·유니온 분기·`PROACTIVE_WIDGET_TRIGGER_KINDS` 3곳 |
| `PROACTIVE_WIDGET_TRIGGER_KINDS` | `['PAGE_DWELL'] as const` — 공개 조회가 내려보내는(위젯이 판정 가능한) 종류 닫힌 목록 |
| `ProactivePathPatternSchema` | `string` trim · 1~200자 · `/`로 시작 · 세그먼트 = `*`｜`**`｜리터럴(공백·`?`·`#`·`*` 불포함) · `**` ≤2 · 연속 `/` 불허 · 끝 `/` 제거 정규화(`/`만 예외). 리터럴은 **디코드된 사람 표기**로 저장(§6.2 매칭은 경로를 디코드해 비교) |
| `ProactiveTriggerSchema` | `z.discriminatedUnion('kind', [PageDwellTrigger])` · `PageDwellTrigger = { kind: 'PAGE_DWELL', pathInclude: 1~10, pathExclude: 0~10, dwellSec: 5~600 }` `.strict()` |
| `ProactiveButtonSchema` | 기존 `ButtonItemSchema` 형식 `{ label, action: 'NODE'｜'MESSAGE'｜'LINK', value }` + 추가 제약: label ≤20 · `MESSAGE` value 1~200 · `NODE` value uuid · `LINK`는 `RichButtonItemSchema`와 같은 `inspectRichUrl`(https·위험 형식 차단) |
| `ProactiveDevice` | `z.enum(['DESKTOP', 'MOBILE'])` |
| `ProactiveScheduleSchema` | `{ days: int 0~6 1~7개 유일, from: 'HH:mm', to: 'HH:mm' }` · `from < to`(자정 넘김 불허 1차) · 요일 = `toKstWeekday()` 체계(0=월) |
| `ProactiveRuleInputSchema` | `.strict()` — `name` · `trigger` · `text`(1~120 · 줄바꿈 ≤2 · `{`…`}` 치환 형태 불허 — FR-PA1-4) · `buttons` 0~3 · `devices` 1~2 유일(생략 시 `['DESKTOP']` — **요청 스키마 기본값이라 응답 바이트와 무관**) · `startsAt?`·`endsAt?`(오프셋 포함 ISO · 시작 < 종료) · `schedule?`(null 허용) · **`purposeConfirmed: z.literal(true)`**. `enabled`·`position`은 **받지 않는다**(생성 = 꺼짐 · 맨 뒤 — 켜기/이동은 별도 경로) |
| `ProactiveSettingsInputSchema` | `.strict()` `{ enabled, maxPerSession, minIntervalSec, quietAfterUserMessageSec }` |
| `ProactiveRuleIssue` | `z.enum(['TARGET_UNAVAILABLE', 'SERVING_UNVERIFIABLE', 'BANNED_WORD', 'LINK_OUTSIDE_POLICY', 'INVALID_STORED'])` |
| `ProactivePeriodState` | `z.enum(['ALWAYS', 'SCHEDULED', 'ACTIVE', 'ENDED'])` |
| `ProactiveRuleViewSchema` | 관리 응답 1규칙 — id·name·enabled·position·trigger·text·buttons·devices·startsAt·endsAt·schedule·periodState·`issues[]`·`warnings[]`(`CONTACT_LIKE`)·`last7d{shown,clicked,dismissed,optedOut}`·`frequentlyDismissed`·purposeConfirmedAt·updatedAt |
| `ProactiveOverviewResponseSchema` | `{ settings{enabled,maxPerSession,minIntervalSec,quietAfterUserMessageSec,updatedAt}, serverEnabled, context{ chatbotStatus, webChannelEnabled, launcherHidden, environmentMode }, limits{ rulesMax, enabledRulesMax }, rules: ProactiveRuleView[] }` |
| `ProactiveStatsQuerySchema` / `ProactiveStatsResponseSchema` | 쿼리 `from?`·`to?`(`YYYY-MM-DD` KST · 기본 최근 7일 · 최대 90일) · 응답 `{ from, to, basis: 'BROWSER_REPORTED', frequentDismiss{ratio,minShown}, totals[{ ruleId, name, deleted, shown, clicked, dismissed, optedOut, clickRate, dismissRate, optOutRate, frequentlyDismissed }], daily[{ day, ruleId, shown, clicked, dismissed, optedOut }] }` · 비율 = `null`(표시 0) 또는 `min(1, 분자/표시)` |
| `PublicProactiveRuleSchema` | **공개 규칙** `{ id, trigger: PageDwellTrigger, text, buttons, devices, showUntil? }` — `.strict()`로 정의해 **이름·순서·기간 원본·시간대·수정자·통계·용도 확인 키가 존재할 수 없다**(PA-5) |
| `PublicProactivePayloadSchema` | `{ caps: { maxPerSession, minIntervalSec, quietAfterUserMessageSec }, rules: PublicProactiveRule[] }` |
| `PublicChatbotConfigWithProactiveSchema` | `PublicChatbotConfigSchema.extend({ proactive: PublicProactivePayloadSchema.optional() })` — **기존 `PublicChatbotConfigSchema`는 수정하지 않는다** |
| `ProactiveEventKind` | `z.enum(['SHOWN', 'CLICKED', 'DISMISSED', 'OPTED_OUT'])` |
| `PublicProactiveEventSchema` | `z.object({ sessionId: uuid, ruleId: uuid, kind }).strict()` — 주소·체류·리퍼러·신호 이름 필드가 **없다**(AC-PA5-2) |
| `findProactiveRulesReferencingNode(rules, nodeId)` | 순수 — `buttons[].action === 'NODE' && value === nodeId`인 규칙 `{ id, name }[]`(콘솔 노드 삭제 경고) |

### 4.2 `packages/shared-types/src/proactive-eval.ts` (zod 무의존 서브패스 — 위젯·콘솔 공용 1벌)

`package.json` `exports`에 `"./proactive-eval": { "types": "./dist/proactive-eval.d.ts", "default": "./dist/proactive-eval.js" }`. 이 파일은 **다른 shared-types 파일을 import하지 않는다**(zod·`common.ts` 반입 방지 — `output-view`·`contrast` 선례, ADR-0012).

| 함수 | 규격 |
|---|---|
| `normalizeProactivePath(pathname)` | 길이 >2048이면 앞 2048자 · 연속 `/` 축약 · 끝 `/` 제거(`/` 제외) · 세그먼트별 안전 `decodeURIComponent`(실패 시 원문) · 세그먼트 수 >256이면 앞 256개 |
| `matchProactivePathPattern(pattern, path)` | **정규식 0** · 세그먼트 배열 비교 · `*` = 정확히 1세그먼트 · `**` = 0개 이상 · 리터럴은 대소문자 구분 정확 일치 · 알고리즘 = 두 포인터 + 마지막 `**` 위치로의 단일 되돌림(고전 와일드카드 매칭 — `O(P·S)`, P ≤ 20 · S ≤ 256) · 패턴 >200자면 `false`(방어) |
| `matchesPathCondition(include[], exclude[], path)` | include 중 하나라도 일치 ∧ exclude 모두 불일치 |
| `selectDueRule(rules, ctx)` | `ctx = { path, dwellMs, device, nowMs, closedRuleIds, firedOnPage }` → 서버 순서(이미 `position` 순)대로 첫 후보: 기기 포함 ∧ 닫은 규칙 아님 ∧ 이 페이지에서 표시 안 함 ∧ 경로 조건 ∧ `dwellMs ≥ dwellSec×1000` ∧ (`showUntil` 없음 ∨ `nowMs < showUntil`) |
| `evaluateProactiveGate(input)` | `input = { nowMs, caps, record: { shownCount, lastShownAtMs?, optedOut, lastUserSendAtMs? }, panelOpen, handoffConnected, launcherVisible, bubbleVisible }` → `{ ok: true }` 또는 `{ ok: false, reason: 'OPTED_OUT'｜'CAP_REACHED'｜'LAUNCHER_HIDDEN'｜'INTERVAL'｜'QUIET_AFTER_SEND'｜'PANEL_OPEN'｜'HANDOFF_CONNECTED'｜'BUBBLE_VISIBLE', final: boolean }` — `final=true`(끄기·상한·런처 숨김)면 컨트롤러가 틱을 멈춘다 |
| `accumulateDwell(prevAccMs, lastTickMs, nowMs, tickMs)` | `acc + min(now − last, 2 × tick)`(절전·스로틀로 벌어진 간격을 과대 산입하지 않음) |

---

## 5. 공개 표면

### 5.1 설정 조회의 선택 확장 — `GET /public/chatbots/:slug/config?proactive=1`

- 활성 조건: 쿼리 `proactive`가 **문자열 `'1'`과 정확히 같을 때만**(배열·`true`·빈 값 = 없는 것과 같음 — 현행 "모르는 쿼리 무시"와 일치).
- 응답: 기존 8키(`slug, name, avatarUrl?, skin, greetingMessage?, quickReplies, launcherPosition, showLauncher`) **뒤에** `proactive` 키 1개(조건부 전개 — 기존 키 순서 불변). 스키마 = `PublicChatbotConfigWithProactiveSchema`.
- 헤더: `Cache-Control: no-store`(현행 그대로 — §5.5).
- 오류: 기존과 같다(없는 슬러그 404 · 비공개·채널 꺼짐 403). 위젯은 선제 조회의 **모든 실패를 조용히 무시**한다(EX-PA-1 · 런처 제거 같은 부수효과 없음 — 404 시 런처 제거는 기존 `handleOpen` 경로만).
- **바이트 동일 보장**(AC-PA1-2 · FR-0-238): 컨트롤러는 쿼리가 없으면 `this.publicConversationService.getConfig(slug)`(인자 1개 — 기존 호출과 동일)를 부른다. 서비스는 기존 객체를 만든 뒤 `if (!opts?.proactive || !this.proactivePublic) return config;` — 선제 코드·추가 쿼리는 이 줄 뒤에만 있다. 가드는 `when` 불일치 → 기존 `ip` 버킷. 시험 = 커밋 ①에서 캡처한 골든 문자열 비교 + Prisma 쿼리 수 동일.

### 5.2 서버 판정 순서 (`ProactivePublicService.buildPayload`)

```
입력: chatbot 행(access.resolve 결과) · now · loadServing: () => Promise<{ bundle, index }>
① PROACTIVE_ENABLED=false → { caps: 기본값, rules: [] }
② ChatbotProactiveSetting 1쿼리 — 없음·꺼짐 → { caps: 행 값 또는 기본값, rules: [] }
③ ProactiveRule findMany { chatbotId, enabled: true, triggerKind ∈ PROACTIVE_WIDGET_TRIGGER_KINDS } orderBy [position, createdAt, id] take 10
④ 규칙별(순수 함수): JSON 파싱 실패 → 제외(INVALID_STORED) · 게시 기간 밖 → 제외 · 표시 시간대 밖(KST 현재) → 제외
⑤ 금지어: BannedWordFilterService.evaluateInbound(문구 · 버튼 라벨 · MESSAGE 값) — 일치 1건 이상 → 제외(EX-PA-12) · 사전 캐시 재사용
⑥ NODE 버튼이 있는 규칙이 1개 이상일 때만 loadServing() 1회(초안 캐시 또는 운영 버전 · 비활성 토픽 제외)
     → 버튼의 노드가 index.nodesById(없으면 bundle.dialogNodes)에 있고 enabled — 하나라도 아니면 규칙 전체 제외
     → loadServing() 실패(ServingVersionUnavailableError 등) → NODE 규칙 전부 제외(닫힌 쪽)
⑦ showUntil = min(endsAt, 오늘 KST 표시 시간대 종료 시각) — 둘 다 없으면 키 생략
⑧ { caps: 설정 값, rules: PublicProactiveRule[] }  (zod parse로 출력 검증 — PA-5)
```

- 추가 쿼리: 스위치 꺼짐 +1 · 켜짐 +2(번들·금지어·운영 코어는 기존 캐시). 허용 도메인 표는 **읽지 않는다**(제약 ⑤).
- `loadServing`을 클로저로 받는 이유: 공개 경로의 소스 선택 지점이 `public-conversation.service.ts` 안 1곳이어야 한다(E-9). 공개 서비스는 `bundleSourceOf`·`DialogueBundleService`·`VersionBundleService`를 주입받지 않는다(PA-9).
- `ProactivePublicService`는 로그에 규칙 문구·세션 id를 남기지 않는다(경고 로그는 챗봇 id·코드만).

### 5.3 수집 — `POST /public/chatbots/:slug/proactive-events`

| 항목 | 규격 |
|---|---|
| 본문 | `PublicProactiveEventSchema`(`.strict()` — 모르는 키 `400 VALIDATION_FAILED`) |
| 응답 | **`204 No Content`**(본문 없음) — 결합 검증 불일치·중복·`PROACTIVE_ENABLED=false`·저장 실패 모두 같다(존재 탐지 불가 · FR-PA5-4 · FR-PA5-7) |
| 슬러그 | `access.resolve()` — 404/403 기존 규약(ADR-0011 §3). 이미 설정 조회로 드러나는 정보다 |
| 처리 순서 | ① 중복 억제 **조회**(메모리 — 있으면 즉시 204 · DB 0) ② `access.resolve` ③ 서버 스위치 ④ 설정 켜짐 ∧ 규칙 `{ id: ruleId, chatbotId }` 존재 ∧ `enabled` ∧ `triggerKind ∈ 위젯 목록`(2쿼리 · 게시 기간·시간대는 **보지 않는다** — 경계 시각에 뜬 말풍선의 닫기 수를 잃지 않게, R-7) ⑤ 중복 억제 **등록** ⑥ `proactive-stat.writer.increment(chatbotId, ruleId, ruleName, toKstDayBucket(now), kind)` — 실패는 `warn` 로그(챗봇 id·코드만) 후 204 |
| 중복 억제 | 키 = `sha256(sessionId + ':' + ruleId + ':' + kind)` 앞 32 hex · 인스턴스 메모리 · 상한 50,000(초과 시 가장 오래된 것부터 제거) · TTL 24시간(봉투 최대 수명과 같음 — ADR-0009) · 재시작·다중 인스턴스에서는 근사(NFR-PAR3 · K-2). **세션 id 원문을 메모리에도 두지 않는다** |
| 증가 | Prisma `upsert`(`where: { ruleId_dayBucket }` · `create: { …, [col]: 1 }` · `update: { [col]: { increment: 1 }, ruleName }`) · `P2002`(동시 생성) 1회 재시도 · 원시 SQL 0 |
| 위치 | `PublicConversationController` **맨 끝** · 서비스 `PublicConversationService.recordProactiveEvent(slug, dto)` → `this.proactivePublic?.recordEvent({ chatbot, dto, now })` |

### 5.4 전용 레이트 버킷

`PublicRateBucketSpec` 확장(기존 사용처의 의미·바이트 불변):

```
kind: 'POLL' | 'FEEDBACK' | 'PROACTIVE_RULES' | 'PROACTIVE_EVENT'
key?: { from: 'param' | 'header' | 'body'; name: string; ns: string }   // 없으면 IP축만
perKeyLimit?: number | { env: string; fallback: number }               // key가 있으면 필수(가드가 없으면 키축 생략)
when?: { query: string; equals: string }                                 // 불일치 = 데코레이터 없음과 동일(기존 ip·session 버킷)
```

| kind | IP축 접두 · 한도 | 키축 | 사용처 |
|---|---|---|---|
| `POLL`·`FEEDBACK` | 불변 | 불변 | 불변 |
| `PROACTIVE_RULES` | `pa-rules-ip` · `PUBLIC_PROACTIVE_RULES_RATE_LIMIT_IP_PER_MIN`(300) | 없음 | `getConfig` + `when: { query: 'proactive', equals: '1' }` |
| `PROACTIVE_EVENT` | `pa-ev-ip` · `PUBLIC_PROACTIVE_EVENT_RATE_LIMIT_IP_PER_MIN`(300) | `pa-ev-key:session:{body.sessionId}` · 20/분 | `recordProactiveEvent` |

- 선제 조회·수집은 대화의 `ip:`·`session:` 버킷을 **소비하지 않는다**(AC-PA5-5). 반대로 대화 폭주가 선제 조회를 막지도 않는다.
- 초과 시 `429` + `Retry-After`(기존 형식). 위젯은 선제 요청의 429를 조용히 무시하고 **재시도하지 않는다**(NFR-PAR1).

### 5.5 캐시

`Cache-Control: no-store` 유지(ADR-0045 §9). 콘솔 문구: "저장하면 방문자의 **다음 페이지 이동부터** 반영됩니다. 이미 떠 있는 안내는 그 페이지에서 그대로 보입니다."

### 5.6 공개 핸들러 수

| 핸들러 | 순번 |
|---|---|
| 기존 8(health · config · messages · 보류 폴링 · 상담 폴링 · 평가 · login · logout) | 1~8 |
| **`PublicConversationController#recordProactiveEvent`** | **9** |

규칙 조회는 기존 `getConfig`의 확장이라 +0.

---

## 6. 위젯

### 6.1 부팅 · 옵트인

- `loader.ts`: `const proactive = scriptEl?.dataset.proactive === 'on';` → `createWidgetApp(mount, { …, proactive })`. **다른 값·속성 없음 = `false`**. `window.__ChatBotWidget`은 `{ version, identify }` 그대로(신호 함수 없음 — P-2).
- `app.ts`: `if (options.proactive && !options.autoOpen) void startProactive();` — 전체 화면(`data-fullscreen="true"`·`/c/:slug`)은 선제 코드 미시작(EX-PA-8). **이 조건이 거짓이면 선제 모듈의 어떤 함수도 호출되지 않는다**(요청·타이머·리스너·`sessionStorage` 쓰기 0 — AC-PA1-6 · FR-0-246).
- `startProactive()`: `client.getConfigForProactive()` → 실패·`proactive` 키 없음·`rules` 0 → 종료. 성공 → **`applySkin(config)` 앞당김**(제약 ⑧ — 런처 위치·숨김·색) → `config.showLauncher === false`면 종료(EX-PA-7) → 컨트롤러 시작.
- 런처 클릭 시 `handleOpen()`의 설정 재조회(쿼리 없음)는 **그대로 둔다**(기존 경로 무변경 · 요청 1건 중복은 선제 사이트만의 비용 — R-11).

### 6.2 체류 판정기 (`core/proactive-controller.ts`)

- **타이머 1개**: `setInterval(tick, 1000)` — 탭이 보일 때만 돈다. `visibilitychange`(선제 전용 리스너 1개 — 컨트롤러가 등록·해제)에서 숨김 = `clearInterval` + 누적 정지, 보임 = `lastTick = now` 후 재개. 탭이 숨은 시간은 산입하지 않는다(FR-PA2-2 · AC-PA3-2).
- **SPA 경로 변경**: 매 틱 `normalizeProactivePath(location.pathname)`을 직전 값과 비교 — 다르면 새 페이지로 보고 `dwellMs = 0` · `firedOnPage` 비움(EX-PA-6). `history.pushState` 가로채기·`popstate` 의존 없음(ADR-0045 §8). 최대 1초 지연.
- 해시(`#…`)·쿼리(`?…`)는 읽지 않는다 — **`location.pathname`만** 읽는다(PA-13).
- 매 틱: 누적(`accumulateDwell`) → `selectDueRule` → 후보가 있으면 `evaluateProactiveGate` → 통과 시 표시. 게이트가 일시 사유(`INTERVAL`·`QUIET_AFTER_SEND`·`PANEL_OPEN`·`HANDOFF_CONNECTED`·`BUBBLE_VISIBLE`)로 막히면 같은 페이지에서 다음 틱에 다시 본다(R-6). `final` 사유면 틱·리스너를 해제한다.
- 규칙이 모두 닫혔거나 상한 도달·끄기 → 틱·리스너 해제(NFR-PAP4).
- 휴대폰(`data-mode="mobile"`) = 기기 `MOBILE`, 그 외 `DESKTOP`(사용자 에이전트 판별 없음 — AC-PA3-10). 휴대폰에서 호스트 페이지의 텍스트 입력 요소가 포커스 중이면(가상 키보드 추정) 표시를 미룬다(FR-PA3-9 · K-10 — 일시 사유 `PANEL_OPEN`과 같은 취급).

### 6.3 게이트 입력의 출처

| 입력 | 출처 |
|---|---|
| `caps` | 서버 응답 `proactive.caps` |
| `record` | `sessionStorage` `cb.pa.{slug}`(§6.6) |
| `panelOpen` | `state.status !== 'CLOSED'`(열림·전송 중·대기·오류 모두 "대화 중") |
| `handoffConnected` | `handoffPollState.mode === 'CONNECTED'` ∨ `loadHandoffToken(slug) !== undefined`(새 페이지에서도 연결 중이면 억제 — FR-PA4-6 위젯 측) · `WATCHING`은 억제하지 않음 |
| `launcherVisible` | `!launcher.root.hidden` |
| `lastUserSendAtMs` | `handleSend()` 첫 줄의 선택 훅 `proactive?.noteUserSend(Date.now())`(선제 컨트롤러가 없으면 no-op — 비선제 사이트 저장소 쓰기 0) |

### 6.4 말풍선 DOM · 접근성 (`ui/proactive-bubble.ts` — ui-designer가 모양 확정)

- 컨트롤러 시작 시 1회 생성해 `cbRoot`(Shadow DOM 안)에 **런처 앞 형제**로 둔다(`hidden`). **패널 밖 알림 영역** `<div id="cb-pa-status" role="status" aria-live="polite" class="cb-sr-only">`도 이때 1개 생성(패널 안 `#cb-status` 불변 — C-7).
- 구성(FR-PA3-3): 표식(챗봇 이름 또는 "챗봇 안내" — **텍스트**) · 문구(`textContent` — HTML 해석 0) · 버튼 0~3(`<button>`, `LINK`는 `<a target="_blank" rel="noopener noreferrer">`) · "안내 닫기"(×, 텍스트 이름) · "이번 방문 동안 안내 끄기". 모든 대상 44×44px 이상 · 닫기·끄기는 다른 버튼과 **같은 크기·대비**(FR-0-247 ⑤).
- 버튼 0개 규칙: 문구 영역 자체를 `<button>`("대화 열기" 역할 — 이름은 문구)로 만든다(FR-PA1-7 · 키보드 도달).
- 표시: `hidden = false` · 알림 영역에 `"챗봇 안내: {문구}"` 1회 기록(같은 말풍선 재기록 금지 — AC-PA8-2) · **`focus()` 호출 0 · `scrollIntoView` 0**(AC-PA3-5) · 페이드 1회(`@media (prefers-reduced-motion: reduce)`면 없음) · 소리·진동·배지·카운트다운 요소 없음(FR-0-247 — 입력 항목 자체가 없다).
- 키보드: 탭 순서는 DOM 순서(말풍선 → 런처 — ui-designer 확정) · 말풍선 안 포커스 + `Esc` = 닫기 → `launcher.focus()` · 마우스로 × 클릭 시에도 포커스가 말풍선 안이었으면 런처로(포커스 유실 방지).
- 자동 사라짐 없음(FR-PA3-6). 사라지는 경우 = 닫기 · 끄기 · 버튼 · 런처 열기 · 페이지 이동.

### 6.5 클릭 처리 = 기존 턴 (엔진 변경 0의 위젯 측)

```
onButton(button):
  send CLICKED
  hide bubble · record.closedRuleIds += rule.id
  view = toOutputViews([{ type: 'BUTTON', payload: { buttons: [button] } }])[0].buttons[0].action   // 기존 변환기
  if view.kind === 'LINK' → window.open(href, '_blank', 'noopener,noreferrer') · 끝
  await handleOpen()                              // 기존 — 설정 조회·인사말(1회)·스킨
  if state.status === 'OPEN' → handleButtonAction(view)   // 기존 — NODE 턴 / MESSAGE 말풍선 + 턴
```

- 인사말이 있으면 인사말 뒤에 버튼 턴 결과가 이어진다(FR-PA3-5).
- `handleButtonAction`·`handleSend`·`sendMessage`·기능 선언 배열은 **수정하지 않는다**(선택 훅 1줄 제외 — §6.3).

### 6.6 브라우저 저장 (`core/proactive-storage.ts`)

- 키 `cb.pa.{slug}` 1개 · 값 `{ v: 1, shownCount, lastShownAtMs?, closedRuleIds: string[](≤20), optedOut, lastUserSendAtMs? }` JSON.
- `sessionStorage`만 · 불가 환경은 **메모리 폴백**(`session.ts`와 같은 탐침 방식 · 인스턴스 분리 — EX-PA-2). 형식 불량 = 초기값.
- 세션 = 탭(FR-PA4-1). 여러 탭은 각자 상한(EX-PA-16 · K-1). 식별 변경(`resetSession`)은 이 키를 건드리지 않는다.
- **`localStorage`·`document.cookie` 사용 0**(위젯 전체 — PA-11).

### 6.7 사건 전송

- `sendProactiveEvent({ sessionId: getOrCreateSessionId(slug), ruleId, kind })` — `fetch(POST, { credentials: 'omit', keepalive: true, referrerPolicy: 'no-referrer', headers: { 'Content-Type': 'application/json' } })` · 결과·오류 **무시**(보내고 잊기 · 재시도 없음 · FR-PA5-7). 본문 키는 정확히 3개(PA-12).
- `getOrCreateSessionId`는 선제 사이트에서 대화 전에도 세션 id를 만들 수 있다(기존 함수 · 저장 위치 동일 · 대화를 시작하면 같은 id를 쓴다). 표시만으로는 서버 로그가 생기지 않는다.
- 미리보기(콘솔)는 이 함수를 쓰지 않는다(AC-PA8-4).

### 6.8 번들 예산 추정

| 조각 | gzip 추정 |
|---|---|
| `proactive-eval`(경로 정규화·매칭·게이트·선택) | 0.8KB |
| 컨트롤러(틱·가시성·경로·저장 연동·전송) | 1.0KB |
| 저장 | 0.3KB |
| 말풍선 DOM·알림·키보드 | 1.2KB |
| 스타일(데스크톱·휴대폰·감속) | 0.6KB |
| 클라이언트 2메서드 · 로더 · 앱 연결 | 0.4KB |
| **합계** | **약 4.3KB**(범위 3.5~4.5) |

현재 15.76KB → **약 20KB**(권고 증가분 ≤5KB · 예산 100KB — `check-bundle-size.mjs` 10행). 초과 시 스타일 축약 → 선택 함수 인라인 순으로 줄인다. frontend-implementer는 커밋 ③에서 실측값을 설계서 §24에 기록한다.

### 6.9 위젯 기능 선언

추가 **0**. `public-client.ts` 86행의 `features` 배열(3개)은 그대로다. 이번 범위는 대화 응답에 아무것도 싣지 않으므로 선언이 필요 없다. 연속 미응답 트리거(2차)가 대화 응답에 선제 제안 선택 키를 실을 때 `proactive-v1`을 더한다(4/5 — 여유 1 남음 · 상한 변경 불필요).

---

## 7. 엔진 변경 0 논증 (요구사항 §12 ⑤)

| 경로 | 이 그룹의 변화 | 근거 |
|---|---|---|
| 말풍선 표시·닫기·끄기 | 대화 요청 **없음** → 엔진 호출 0 · 로그 0 | §6.4 · §6.7 |
| `NODE` 버튼 | 위젯 기존 `handleButtonAction` → 기존 `POST …/messages` `buttonAction: { kind: 'NODE', nodeId, label }` → `resolveTurn` → `resolveByNodeId`(켜진 노드 실행 — `resolver.ts` 817~819행) → 로그 `inputKind = BUTTON_NODE` | AC-PA3-6 |
| `MESSAGE` 버튼 | 기존 사용자 말풍선 + 문장 턴(입구 금지어 필터 대상 — 저장 시 이미 금지어 검사) | AC-PA3-7 |
| 사라진 노드 | 조회 단계에서 규칙 제외(§5.2 ⑥). 표시 후 삭제된 경우만 `NODE_BY_ID_NOT_FOUND` → 폴백(861~867행 · 현행 규칙상 미응답 기록 가능 — K-5) | EX-PA-4 |
| 공개 메시지 요청·응답 스키마 · `sendMessage` · 기능 선언 | **변경 0** | §2.5 금지 목록 |

정적 검사: `packages/dialogue-engine/**`·`apps/ml-worker/**`·`apps/api/src/conversation/adapters/**`에 `proactive`(대소문자 무시) 0 · `public-conversation.service.ts`에서 `proactive` 토큰은 `getConfig`·`recordProactiveEvent`·생성자 안에서만(PA-1 · PA-8).

---

## 8. 개인정보 0 자체 점검 (요구사항 §12 ⑦ · NFR-PAM1 · R-5)

| 질문 | 답 | 보장 장치 |
|---|---|---|
| 페이지 주소가 서버로 가는가 | **아니다** — 조회 URL은 슬러그 + `?proactive=1`뿐 · 수집 본문에 주소 필드 없음 · 두 요청 모두 `referrerPolicy: 'no-referrer'` | PA-4 · PA-12 · PA-13 |
| 체류 시간이 서버로 가는가 | **아니다** — 판정은 위젯 순수 함수 · 사건에는 종류만 | PA-12 |
| 서버가 사건 시각을 저장하는가 | **아니다** — KST 일 버킷 정수만 · `updatedAt`은 행 단위(마지막 증가 시각 — 개인과 무관) | PA-3 |
| 세션 id가 저장되는가 | **아니다** — 중복 억제는 해시 키를 메모리에 24시간 이하 · DB·로그 0 | §5.3 · PA-10 |
| IP가 저장되는가 | **아니다** — 레이트 버킷 메모리 창(1분)만(기존 버킷과 같음) | 기존 |
| 식별 토큰·고객 정보를 쓰는가 | **아니다** — 선제 요청에 `x-cb-identity` 헤더 없음 · `proactive/**`가 `inbox/**` import 0 | PA-9 · FR-0-241 |
| 브라우저에 오래 남는가 | **아니다** — `sessionStorage` 1키(탭 종료 시 삭제) · `localStorage`·쿠키 0 | PA-11 |
| 서버 판정 대상 | 규칙 정의·켜짐·게시 기간·표시 시간대(KST)·금지어·노드 유효성뿐 | FR-0-242 |

한계(정직하게): 선제 조회 요청이 온다는 사실 자체와 그 시각·IP·UA는 네트워크 수준에서 서버·프록시에 보인다(애플리케이션은 저장하지 않음 — 리버스 프록시 접근 로그는 운영 설정 책임 · K-13). 기존 위젯 요청(런처 클릭 후 설정·메시지)은 브라우저 기본 리퍼러 정책을 그대로 따른다(이 그룹 범위 밖 — K-11).

---

## 9. 관리 API

### 9.1 경로 (`ProactiveController` — `chatbots/:chatbotId/proactive`)

| # | 메서드·경로 | 권한 | 동작 |
|---|---|---|---|
| 1 | `GET /chatbots/:chatbotId/proactive` | `channel:read` | 목록(설정 + 규칙 + 문제·기간 상태 + 최근 7일 + 맥락) — 콘솔 노드 삭제 경고도 이 응답으로 계산 |
| 2 | `PUT /chatbots/:chatbotId/proactive/settings` | `channel:write` | 스위치·상한·간격·조용한 시간(전체 교체) — 값이 같으면 감사 없음 |
| 3 | `POST /chatbots/:chatbotId/proactive/rules` | `channel:write` | 생성(꺼짐 · 맨 뒤) → `201` 규칙 뷰 |
| 4 | `GET /chatbots/:chatbotId/proactive/rules/:ruleId` | `channel:read` | 상세 |
| 5 | `PUT /chatbots/:chatbotId/proactive/rules/:ruleId` | `channel:write` | 전체 교체(켜짐·순서 제외 · `purposeConfirmed: true` 필수) |
| 6 | `DELETE /chatbots/:chatbotId/proactive/rules/:ruleId` | `channel:write` | 삭제 `204`(집계는 남음) |
| 7 | `POST …/rules/:ruleId/enable` | `channel:write` | 켜기(켜진 10개면 `400 LIMIT_EXCEEDED` · 상태 불변) |
| 8 | `POST …/rules/:ruleId/disable` | `channel:write` | 끄기(멱등) |
| 9 | `POST …/rules/:ruleId/move` | `channel:write` | `{ direction: 'UP'｜'DOWN' }` — 이웃과 `position` 교환(토픽 이동 선례) · 끝이면 무변경 `200` |
| 10 | `GET /chatbots/:chatbotId/proactive/stats?from=&to=` | `channel:read` | 통계(§11) |

- 챗봇 스코프 규약: 없는·교차 챗봇 = `404` · 쓰기는 `ChatbotScopeService.assertWritable`(보관 챗봇 `409 CHATBOT_ARCHIVED`) · 읽기는 보관 챗봇도 허용.
- 복제(FR-PA1-9)는 **경로를 만들지 않는다** — 콘솔이 기존 규칙 값으로 생성 폼을 채우고(이름 "(복사본)") 사용자가 용도 확인 후 3번으로 저장한다(용도 확인이 복제에도 사람 행위로 남는다 — R-4).
- 신규 `ApiErrorCode` **0종** — `VALIDATION_FAILED`(400) · `INVALID_REFERENCE`(400) · `DUPLICATE_NAME`(409) · `LIMIT_EXCEEDED`(400 — 기존 사용례와 같음) · `NOT_FOUND`(404) · `CHATBOT_ARCHIVED`(409) · `FORBIDDEN`(403 — 가드).

### 9.2 저장 검증 (`proactive-rules.service.ts` — 쓰기 유일 파일)

| 순서 | 검사 | 실패 |
|---|---|---|
| 1 | zod `ProactiveRuleInputSchema`(용도 확인 `true` · 길이 · 치환 형태 · 패턴 문법 · https · 기간·시간대 순서) | `400 VALIDATION_FAILED`(필드별 `details`) — AC-PA2-2·3·4·7 |
| 2 | `NODE` 버튼 노드 = **초안**에 존재 ∧ `enabled`(`dialogNode.findMany { id in, chatbotId, enabled: true }` 1쿼리) | `400 INVALID_REFERENCE`(버튼 위치) |
| 3 | 금지어(문구·라벨·MESSAGE 값 — `BannedWordFilterService.test` 계열, 일치 1건 이상) | `400 VALIDATION_FAILED`(필드 `text`/`buttons.N.label`) — AC-PA7-4 |
| 4 | `LINK` 버튼 호스트 ∈ 챗봇 허용 도메인(`chatbotRichUrlPolicy` 읽기 1쿼리 — **쓰기 아님** · 목록 없음/빈 목록 = 제한 없음 · `hostMatchesRules`) | `400 VALIDATION_FAILED`(필드 `buttons.N.value`) — FR-PA1-6 |
| 5 | 이름 정규화 유일 | `409 DUPLICATE_NAME` |
| 6 | 생성: 챗봇 규칙 수 < 20(트랜잭션 안 count) | `400 LIMIT_EXCEEDED` |
| 7 | 전화·이메일처럼 보이는 문자열(`contact-like.ts`) | **차단 아님** — 응답 `warnings: ['CONTACT_LIKE']` |

- 운영 모드(환경 분리)에서 초안에는 있지만 운영 버전에 없는 노드: 저장은 성공하고 목록 `issues: ['TARGET_UNAVAILABLE']`(운영 전환 뒤 사라짐 — AC-PA9-2).
- 켜기(7번): 설정 스위치와 무관하게 규칙만 켠다(스위치 꺼짐이면 목록 상단 안내). 트랜잭션 안에서 켜진 수 확인 후 갱신(SQLite 직렬화).

### 9.3 용도 확인

- 요청 `purposeConfirmed: true`는 **생성·수정마다 필수** — 저장 시 `purposeConfirmedAt = now`, `purposeConfirmedById = actor`. 켜기/끄기/이동/삭제는 문구를 바꾸지 않으므로 요구하지 않는다.
- 감사 요약 끝에 `· 광고·판촉 목적 아님 확인`(AC-PA2-1). 문구 원문은 요약·전후 스냅샷 어디에도 없다(§12.1).
- 콘솔 운영 지침(FR-PA1-8) 문구는 ui-designer — "도움 안내 예시 · 할인·이벤트 등 홍보 문구는 법무 확인 후".

### 9.4 목록 응답의 문제 판정 (`rule-servability.ts` — 공개 필터와 1벌)

| issue | 판정 | 공개 조회에서 |
|---|---|---|
| `TARGET_UNAVAILABLE` | `NODE` 버튼 노드가 서비스 중 번들에 없거나 꺼짐(관리 화면은 `proactive-target-check.service.ts`가 `bundleSourceOf` → 초안 캐시 또는 운영 버전 `{ topics: 'ACTIVE_ONLY' }`) | 제외 |
| `SERVING_UNVERIFIABLE` | 운영 버전 읽기 실패 | 제외(NODE 규칙) |
| `BANNED_WORD` | 현재 금지어 사전과 일치(EX-PA-12) | 제외 |
| `LINK_OUTSIDE_POLICY` | 현재 허용 도메인 밖 `LINK` | **제외하지 않음**(공개 경로는 허용 목록을 읽지 않는다 — K-8) |
| `INVALID_STORED` | 저장 JSON 파싱 실패 | 제외 |

맥락 플래그(규칙 공통): `chatbotStatus`(ACTIVE 아님 = 공개 안 됨) · `webChannelEnabled` · `launcherHidden`(WEB `showLauncher=false` — EX-PA-7 안내) · `environmentMode`(`prodVersionId != null`).

---

## 10. 노드 삭제 · 배포 관계 (요구사항 §12 ③ · J-13 · FR-PA9)

| 사건 | 규칙 | 공개 조회 | 콘솔 |
|---|---|---|---|
| 노드 삭제(초안) | 그대로 | 초안 서빙 챗봇: 다음 조회부터 규칙 제외 · 운영 서빙 챗봇: 운영 버전에 노드가 남아 있는 동안 유지 | 목록 `TARGET_UNAVAILABLE`(서비스 중 기준) · **삭제 확인 창에 "이 노드를 가리키는 선제 안내 N개"**(§13) |
| 노드 끄기 | 그대로 | 위와 같음(`enabled` 판정) | 위와 같음 |
| 토픽 비활성(No.22) | 그대로 | 번들에서 빠지므로 제외(FR-PA9-3) | 위와 같음 |
| 운영 전환·롤백(No.40) | 그대로 | 새 운영 버전 기준으로 판정(AC-PA9-2) | 다음 목록 조회부터 반영 |
| 버전 복원(No.25) · 예약 실행(No.28) | **변경 0**(스냅샷 밖) | 복원 후 번들 기준 판정 | AC-PA9-3 |
| 챗봇 복사 · 토픽 분리 | 복사하지 않음(FR-PA9-4) | — | — |
| 챗봇 영구삭제 | 설정·규칙·집계 동반 삭제 | — | — |
| 표시 후 노드 사라짐 | — | 이미 뜬 말풍선은 그 페이지에서 유지 → 클릭 시 엔진 폴백(K-5) | 캐시 없음 안내(§5.5) |

- 노드 삭제 API·`reference-check.service.ts`·`dialog-nodes/**`는 **변경 0**. 경고는 콘솔이 규칙 목록(`channel:read`)을 읽어 `findProactiveRulesReferencingNode()`로 계산한다 — 사용자에게 `channel:read`가 없거나 조회가 실패하면 경고 없이 기존 확인 창만 보인다(비차단 · R-9).

---

## 11. 통계

- 원천 = `ProactiveDailyStat`만(대화 로그·No.14·No.29 수치·스키마 불변 — FR-PA6-6 · AC-PA6-5).
- 쿼리 = `findMany { chatbotId, dayBucket in [from, to] }`(인덱스 `chatbotId, dayBucket` · 최대 20규칙 × 90일 = 1,800행) → `stats-aggregate.ts` 순수 함수로 합계·일별·비율. 현재 규칙 이름이 있으면 그것, 삭제된 규칙은 마지막 스냅샷 + `deleted: true`(FR-PA6-5 · AC-PA6-3).
- 비율: `clickRate = min(1, clicked/shown)` · `dismissRate = min(1, dismissed/shown)` · `optOutRate = min(1, optedOut/shown)` · 표시 0이면 `null`(FR-PA5-6 — `SHOWN` 없이 온 클릭이 분모를 넘지 않게).
- 자주 닫힘(FR-PA6-3): `shown ≥ 100` ∧ `(dismissed + optedOut) / shown ≥ 0.5` → `frequentlyDismissed: true`(목록은 최근 7일 기준 · 통계는 선택 기간 기준) · **자동 끄기 없음**(AC-PA6-2).
- 참고치 고지(FR-PA6-4): 응답 `basis: 'BROWSER_REPORTED'` → 콘솔 상시 문구.
- 그룹·전역 합산(No.29)은 2차.

---

## 12. 권한 · 감사 · 거버넌스 (요구사항 §12 ⑧)

### 12.1 감사

| 동작 | action · targetType | before/after(화이트리스트) | summary |
|---|---|---|---|
| 설정 저장(값 변화 시) | `UPDATE` · `Chatbot` · targetName = 챗봇 이름 | `{ proactive: { enabled, maxPerSession, minIntervalSec, quietAfterUserMessageSec } }` — `AUDIT_FIELDS.Chatbot` +`'proactive'` | `선제 안내 설정 변경: 사용 false → true · 세션당 최대 1 → 2`(바뀐 것만) |
| 규칙 생성 | `CREATE` · `ProactiveRule` | after = `AUDIT_FIELDS.ProactiveRule` | `선제 안내 '{이름}' 생성 · 광고·판촉 목적 아님 확인` |
| 규칙 수정 | `UPDATE` · `ProactiveRule` | before/after | `바뀐 항목: 문구, 버튼, 조건 · 광고·판촉 목적 아님 확인`(**항목 이름만**) |
| 켜기/끄기 | `UPDATE` · `ProactiveRule` | before/after(`enabled`) | `사용 여부 변경: false → true`(채널 선례 — STATUS_CHANGE 아님) |
| 이동 | `UPDATE` · `ProactiveRule`(이동한 규칙 1건) | `position` | `순서 변경: 위로` |
| 삭제 | `DELETE` · `ProactiveRule` | before | — |

- `AUDIT_FIELDS.ProactiveRule = ['name', 'enabled', 'position', 'triggerKind', 'trigger', 'devices', 'startsAt', 'endsAt', 'schedule', 'purposeConfirmedAt']` — **`text`·`buttons` 없음**(FR-PA7-5 · PA-15). 경로 패턴(`trigger`)은 관리자 설정이라 포함한다.
- `AuditTargetType` 34 → 35 · `AUDIT_TARGET_LABELS.ProactiveRule = '선제 안내'` · `AuditAction` 추가 0 · 라우트 맵 추가 0.
- 거버넌스 모드 ON의 열람 감사(`VIEW` 닫힌 목록)에는 넣지 않는다(개인정보 없음).

### 12.2 권한

신규 권한·역할 **0**(`security.ts` 불변) — 조회·통계 `channel:read` · 변경 `channel:write`(`channels.controller.ts` 13·19·30행과 같은 등급). `channel:read`만 있으면 콘솔 편집 비활성 + API `403`(AC-PA2-6 · AC-PA8-5).

### 12.3 데이터 지도 · 거버넌스 모드

- `GovernanceMapResponseSchema` 선택 키(규칙 ≥1 ∨ 켜진 스위치 ≥1일 때만 — 없으면 **키 생략 = 바이트 동일**):
  ```
  proactive?: {
    chatbotsEnabled: int,          // 스위치 켜진 챗봇 수
    rules: int, enabledRules: int,
    counters: 'RULE_DAILY_COUNTS_ONLY',     // 개인 식별 정보 없음
    browserStorage: 'SESSION_STORAGE',      // 탭 종료 시 삭제
    serverEnabled: boolean                  // PROACTIVE_ENABLED
  }
  ```
  콘솔은 FR-PA7-4의 세 행(규칙 · 집계 · 브라우저 저장)으로 렌더한다. 쿼리 +2(`count` · `count where enabled`) — 선택 키가 생략되는 설치는 `count` 1회로 판정(+1).
- 거버넌스 모드 ON에서도 동작 동일(AC-PA7-1) — 서버 외부 송신 0 · 출구 레지스트리·기동 검사 불변 · 보존·암호화 대상 추가 0.
- No.45와의 충돌: 없음 — 파기 잡·writer·체인은 이 테이블들을 모르고(보존 종류 밖), 감사는 기존 `record()` 1곳을 탄다.

---

## 13. 콘솔 · 위젯 UI 인계 (ui-designer → frontend-implementer)

| 화면 | 요구 | 구조 제약(UIUX 준수기준) |
|---|---|---|
| **위치** | 챗봇 상세 > 채널 탭의 **웹 채널 영역 안 "선제 안내" 섹션**을 권장(`apps/web/src/pages/chatbot-detail/ChannelsTab.tsx`에 마운트). 새 최상위 탭으로 만들면 `TabNav.spec.tsx` 기대값이 바뀐다 — 그 경우 X-8로 이 문서에 추가하고 오케스트레이터 승인 | — |
| 설정 | 스위치 · 세션당 최대(1~3) · 최소 간격(30~600초) · 조용한 시간(60~1800초) · "서버에서 꺼짐"(`serverEnabled=false`) · 런처 숨김·채널 꺼짐·비공개 안내 · "저장 즉시 반영 · 환경과 무관" 안내(FR-PA9-1) | 레이블 있는 입력 · 저장 시 인라인 오류(§7) |
| 규칙 목록 | 이름 · 조건 요약 · 켜짐 토글 · 기간 상태 · 문제 배지(`TARGET_UNAVAILABLE` = "연결 대상 없음 — 표시되지 않음") · 최근 7일 표시/클릭/닫기 · 자주 닫힘 안내 · **위/아래 이동 버튼**(드래그는 선택) · 복제 · 삭제 | 표 + 텍스트 배지(색만으로 전달 금지 §1) · 키보드 이동(§3) |
| 규칙 편집 | 조건 종류(1차 "페이지 머묾" 1개 — 라디오 1개 또는 고정 텍스트) · 포함/제외 경로(행 추가형) + **경로 검사 도구**("이 주소에서 맞나요?" — `matchesPathCondition` 사용) · 머문 시간 · 문구(남은 글자 수 실시간 §5) · 버튼 0~3(동작 라디오 · `NODE`는 켜진 노드 검색 선택) · 기기 체크박스(기본 데스크톱만) · 게시 기간 · 표시 시간대 · **용도 확인 체크(필수)** + 운영 지침 | 라디오/체크박스(§6) · 필수 표시 · 오류는 저장 시점 인라인 |
| 미리보기 | 데스크톱·휴대폰 말풍선 모습(챗봇 스킨 색) — React 근사 렌더(위젯 DOM 재사용 아님 — K-7) · 사건 전송 0 | — |
| 통계 | 기간(7·30일·사용자 지정 ≤90) · 규칙별 합계·클릭률·닫기율·끄기율 · 일별 표 + 그래프(같은 수치의 표 필수) · 참고치 문구 상시 | 그래프만으로 전달 금지 |
| 삽입 안내 | 기존 삽입 코드에 `data-proactive="on"` 속성을 더한 예시(콘솔이 기존 삽입 코드 문자열에 속성을 끼워 보여 준다 — 서버 `embed-code.service.ts` 변경 0) · "사이트 삽입 코드를 바꿔야 동작합니다" · 전체 화면 링크에서는 뜨지 않음 | — |
| 노드 삭제 확인 창 | `apps/web/src/pages/dialogue/NodesListPage.tsx`(및 노드 편집 화면의 삭제 확인이 있으면 그곳) — 규칙 목록을 읽어 참조 규칙이 있으면 "이 노드를 가리키는 선제 안내 N개(이름…)가 더 이상 표시되지 않습니다" 경고 · **삭제는 막지 않음** | 경고 문구는 확인 창 본문(스크린 리더가 읽는 위치) |
| 데이터 지도 | `proactive` 선택 키가 있으면 세 행 | — |
| **위젯 말풍선** | §6.4 — 위치(런처 위/옆 · `LEFT` 대응) · 휴대폰 최대 높이 · 탭 순서(말풍선 → 런처 권장) · 표식 문구 · 끄기 문구 "이번 방문 동안 안내 끄기"(P-3 · FR-0-250) | NFR-PAA1~7 · FR-0-247 |

- API 클라이언트 `apps/web/src/api/proactive.ts`(신규) · 화면 파일은 `apps/web/src/pages/chatbot-detail/proactive/`(신규 디렉터리) 권장.
- `UIUX_준수기준.md`에 "선제 안내 말풍선" 패턴 추가 제안(요구사항 §10)은 ui-designer가 초안 → 커밋 ④.

---

## 14. 봉인 · 정적 검사

서버·공유: `apps/api/src/proactive/lib/proactive-sealing.spec.ts` · 위젯: `apps/widget/src/core/proactive-sealing.spec.ts`.

| # | 단언 |
|---|---|
| **PA-1** | `packages/dialogue-engine/**`·`apps/ml-worker/**`·`apps/api/src/conversation/adapters/**`에 `proactive`(대소문자 무시·주석 제외) 0 · `EgressExitId.options.length === 7` |
| **PA-2** | `proactiveRule.(create｜createMany｜update｜updateMany｜upsert｜delete｜deleteMany)(` 호출 파일 = `proactive/proactive-rules.service.ts` + `chatbots/chatbots.service.ts`(deleteMany만) · `chatbotProactiveSetting` 쓰기 = `proactive-settings.service.ts` + chatbots(deleteMany) · `proactiveDailyStat` 쓰기 = `proactive/core/proactive-stat.writer.ts` + chatbots(deleteMany) |
| **PA-3** | `schema.prisma`의 `ProactiveDailyStat` 블록에 `sessionId｜session｜ip｜url｜path｜referrer｜userAgent｜identity｜customer` 필드 0 · `ProactiveRule`·`ChatbotProactiveSetting`도 같은 토큰 0(AC-PA6-4) |
| **PA-4** | `PublicProactiveEventSchema`가 strict이고 키 집합 = `{sessionId, ruleId, kind}` |
| **PA-5** | `PublicProactiveRuleSchema` 키 집합 = `{id, trigger, text, buttons, devices, showUntil}` · `PublicProactivePayloadSchema` 키 = `{caps, rules}` · 공개 스키마 파일 영역에 `name｜position｜startsAt｜endsAt｜schedule｜purpose｜updatedBy｜createdBy｜shown` 키 0(AC-PA5-1) |
| **PA-6** | `proactive-eval.ts`에 `RegExp(`·정규식 리터럴 0 · import 0(zod 무의존) |
| **PA-7** | `*.controller.ts` `@Public()` 총 9 · 9번째 = `PublicConversationController#recordProactiveEvent`(메서드 앞 600자에 `@Public()`·`@PublicRateBucket(`·`kind: 'PROACTIVE_EVENT'`) · `proactive/**`에 `@Public(` 0 |
| **PA-8** | `public-conversation.service.ts`의 `proactive` 토큰(주석 제외)은 `getConfig`·`recordProactiveEvent` 메서드 본문과 생성자에만 · `bundleSourceOf(`·`.getCached(`·`versionBundles.get(` 각 1회(E-9 재확인) |
| **PA-9** | `proactive/public/**`가 `chatbotRichUrlPolicy`·`/inbox/`·`/handoff/`·`@chat-bot/dialogue-engine`·`bundleSourceOf`·`DialogueBundleService`·`VersionBundleService` 참조 0 · `ProactiveModule` exports = `['ProactivePublicService']` |
| **PA-10** | `proactive/**`의 `logger.(log｜warn｜error｜debug)(` 줄에 `sessionId｜text｜label｜value` 토큰 0 · 중복 억제 파일에 `createHash(` 존재(원문 키 보관 금지) |
| **PA-11** | `apps/widget/src/**`(spec 제외)에 `localStorage`·`document.cookie` 0 |
| **PA-12** | 위젯 `public-client.ts`의 선제 2메서드에 `referrerPolicy: 'no-referrer'` · 수집 본문 객체 리터럴 키 = `sessionId, ruleId, kind` · `sendMessage`의 `features` 배열 요소 3개(불변) |
| **PA-13** | 위젯 `proactive-*.ts`·`ui/proactive-bubble.ts`에 `location.href｜location.search｜location.hash｜document.referrer｜document.URL` 0(`location.pathname`만) · `history.pushState｜replaceState` 대입 0 |
| **PA-14** | `proactive/**`에 `conversationLog.`·`logService.record(` 0(표시로 로그 생성 0) |
| **PA-15** | `audit-snapshot.ts`의 `AUDIT_FIELDS.ProactiveRule`에 `text`·`buttons` 없음 |
| **PA-16** | `WebChannelConfigSchema.shape` 키 집합 = `{allowedOrigins, greetingMessage, quickReplies, launcherPosition, showLauncher, feedbackEnabled}`(불변) · `PublicChatbotConfigSchema.shape` 키 8개(불변) |
| **PA-17** | `BUCKET_SPEC_BY_KIND.POLL`·`.FEEDBACK` 값 불변(문자열 비교) · `PROACTIVE_RULES`·`PROACTIVE_EVENT` 접두가 `ip:`·`session:`·`poll-`·`fb-`와 겹치지 않음 |
| **PA-18** | 위젯 선제 파일에 `environment` 토큰 0(E-10 재확인) · `ui/proactive-bubble.ts`의 `.focus(` 호출은 닫기/Esc 처리 함수 안에만(표시 함수 본문 0) |

---

## 15. 성능 예산

| 경로 | 목표 |
|---|---|
| `GET …/config`(쿼리 없음) | **불변**(쿼리 수·지연 동일 — 골든) |
| `GET …/config?proactive=1` | 스위치 꺼짐 +1쿼리 · 켜짐 +2쿼리(+번들 캐시 적중 시 0) · P95 = 기존 설정 조회 + 20ms 이하(켜진 규칙 10 · NFR-PAP1) |
| `POST …/proactive-events` | 중복 = DB 0 · 정상 = 5쿼리(access 2 + 설정 1 + 규칙 1 + upsert 1) · P95 50ms |
| 대화 턴 · 폴링 · 평가 | **불변**(이 그룹은 대화 경로를 건드리지 않음 — `data-governance-query-count-*` 시험 불변) |
| 관리 목록 | P95 300ms(규칙 20 · 번들 캐시) |
| 통계 | P95 300ms(1,800행) |
| 데이터 지도 | +1(선택 키 생략) / +2 |
| 위젯 | 증가분 gzip ≤5KB(추정 4.3KB) · 선제 미사용 페이지 요청·타이머·리스너 +0 · 선제 페이지 타이머 1(1초) · 리스너 1(`visibilitychange`) |
| 중복 억제 메모리 | ≤ 50,000 키 × 약 100B ≈ 5MB |

---

## 16. 시험 전략 (test-automation 인계)

### 16.1 층별 핵심

| 층 | 수단 | 핵심 시나리오 |
|---|---|---|
| shared-types 단위 | jest/vitest | 경로 정규화·매칭 표(`*`·`**`·끝 `/`·한글 디코드·대소문자) · **1만 자 경로 × 1,000회 시간 상한**(AC-PA7-5) · 게이트 사유별 · `selectDueRule` 순서·기기·닫음·`showUntil` · 스키마(용도 확인 false → 실패 · `{name}` · 121자 · `http://` · 정규식 패턴 `^/order.*$` 거부 — AC-PA2-2·3·4·7) · 공개 스키마 키 집합(PA-4·5) |
| API 순수 함수 | jest | `schedule-window`(KST · 요일 0=월 · 경계 · `showUntil` — 가짜 시계, **상대 시각 원칙**) · `rule-servability` · `stats-aggregate`(상한 · null · 자주 닫힘 100/50%) · 감사 요약(원문 0) · 중복 억제(해시 · TTL · 상한 퇴출) · 가드 `when`/`body`/키 없음 |
| API 통합(`prisma migrate deploy` DB) | supertest | **AC-PA1-2 골든 바이트 동일**(스위치 켜짐 + 켜진 규칙 2개 + 쿼리 없음) · 쿼리 수 동일 · `?proactive=1` 페이로드(꺼짐·기간 밖·시간대 밖·금지어·노드 삭제·노드 꺼짐·토픽 비활성·운영 모드 초안 전용 노드 → 전환 후 포함 — AC-PA4-6 · AC-PA9-1·2) · 버전 복원 후 규칙 불변(AC-PA9-3) · 수집 결합 검증(타 챗봇·꺼짐·없음 → 204 · 카운터 불변 — AC-PA5-3) · 5회 → +1(AC-PA5-4) · `url` 키 → 400(AC-PA5-2) · **수집 버킷 초과 뒤 같은 IP 대화 200**(AC-PA5-5) · `PROACTIVE_ENABLED=false`(동적 import — AC-PA5-6) · 권한 403(AC-PA2-6) · 상한 400(AC-PA2-5) · 감사 1건·원문 없음(AC-PA2-1) · 영구삭제 3테이블 · **표시·닫기·끄기 수집 후 해당 세션 로그 0행**(AC-PA1-7) · 수집 전후 대시보드·통합 통계 동일(AC-PA6-5) · 거버넌스 모드 ON 동일 + 지도 세 행(AC-PA7-1·2) · 메시지 요청 키 집합 불변(AC-PA1-3 회귀) |
| 위젯 | vitest + jsdom(가짜 타이머 · `document.visibilityState` 모의 · `fetch` 스파이) | **속성 없음 → 60초 요청 0 · `setInterval`/`addEventListener('visibilitychange')` 호출 수 도입 전과 같음**(AC-PA1-6) · 29초/30초(AC-PA3-1) · 숨김 5분 불산입(AC-PA3-2) · 제외 경로(AC-PA3-3) · 포커스·스크롤·패널 불변(AC-PA3-5) · NODE 클릭 → `buttonAction` 1건 + CLICKED(AC-PA3-6) · MESSAGE(AC-PA3-7) · 10분 유지(AC-PA3-8) · 감속 선호(AC-PA3-9) · 모바일 필터(AC-PA3-10) · 상한·간격(AC-PA4-1) · 닫은 규칙 재표시 없음/새 탭(AC-PA4-2) · 끄기 → 전부 중지(AC-PA4-3 앞부분) · 패널 열림·조용한 시간(AC-PA4-4) · `CONNECTED`·저장 토큰(AC-PA4-5) · `showUntil`(AC-PA4-7) · `<img onerror>` 텍스트(AC-PA7-3) · Tab/Esc(AC-PA8-1) · 알림 1회(AC-PA8-2) · SPA 경로 변경 · 수집 본문 키 3개·`referrerPolicy` · 봉인 PA-11~13·18 |
| 콘솔 | vitest + a11y(`*.a11y.spec.tsx` 선례) | 키보드만으로 생성·이동(AC-PA8-3) · 미리보기 수집 0(AC-PA8-4) · 읽기 전용(AC-PA8-5) · 통계 표+그래프 · 노드 삭제 경고(비차단) |
| 번들 | `pnpm --filter @chat-bot/widget build` + `check-bundle-size.mjs` | 100KB 이하 · 증가분 기록 |

### 16.2 시험 작성 원칙

- 시각은 **상대값**(가짜 시계 `now` 기준 ±) — 게시 기간·시간대·`showUntil`·중복 억제 TTL.
- 선택 기능을 켜는 spec은 값을 먼저 설정한 뒤 `await import('../app.module')`(`CLAUDE.md`).
- 골든은 커밋 ①에서 **서버 변경 전** 캡처한다(같은 seed · 문자열 비교 — 키 순서 포함).
- 통합 시험 DB는 `prisma migrate deploy`.

### 16.3 ★ 의도된 기존 시험 기대값 변경 (닫힌 목록 — FR-0-249 확정)

| # | 파일 | 변경 | 사유 | 커밋 |
|---|---|---|---|---|
| **X-1** | `apps/api/src/common/auth/public-decorator-count.spec.ts` | `@Public()` 8 → **9**(주석·제목 포함) · 전수 스캔 컨트롤러 목록 +`ProactiveController`(**48 → 49**) · `isPublic(PublicConversationController.prototype, 'recordProactiveEvent')` = true 단언 추가 | 수집 경로 1 · 관리 컨트롤러 1 | ② |
| **X-2** | `apps/api/src/feedback/lib/feedback-sealing.spec.ts` F-6 | `toBe(8)` → `toBe(9)`(제목 문구) — `submitFeedback` 앞 600자 검사는 불변 | 같음 | ② |
| **X-3** | `apps/api/src/deploy-schedules/lib/deploy-schedule-sealing.spec.ts` D-5 | 8 → 9 | 같음 | ② |
| **X-4** | `apps/api/src/handoff/lib/handoff-sealing.spec.ts` H-10 | 8 → 9 · 제목에 "9번째는 recordProactiveEvent" — `pollHandoff` 앞 400자 검사 불변 | 같음 | ② |
| **X-5** | `apps/api/src/validation/lib/validation-sealing.spec.ts` 7) | 8 → 9 | 같음 | ② |
| **X-6** | `apps/api/src/versions/lib/version-sealing.spec.ts` V-8 | 8 → 9 | 같음 | ② |
| **X-7** | `apps/api/src/chatbots/chatbots.service.spec.ts` | 영구삭제 `deleteMany` 24 → **27**테이블(`proactiveDailyStat`·`proactiveRule`·`chatbotProactiveSetting`) | 동반 삭제 | ② |

- **바뀌지 않는 것(확인 완료)**: `rich-message-sealing.spec.ts` RM-7(제목만 "8 유지" — 단언은 디렉터리 0건)·RM-8(`EgressExitId` 7)·RM-12(부분 인덱스 4) · `topic-sealing.spec.ts` T-9(디렉터리 0건 단언) · `environment-sealing.spec.ts` E-9(소스 선택 1회 — `loadServing` 클로저) · `public-rate-limit.guard.spec.ts`(명세 타입이 넓어질 뿐 — 기존 명세 그대로 유효) · `data-governance-query-count-*`(대화 턴 경로 불변) · 데이터 지도 응답 시험(선택 키 생략) · 공개 설정 응답 스키마 시험(`PublicChatbotConfigSchema` 불변).
- 위 목록 밖에서 기존 시험이 깨지면 **구현 결함**으로 본다(목록 추가는 system-architect 승인 — 예: 콘솔을 새 탭으로 만들 때의 `TabNav.spec.tsx` = X-8 후보).

---

## 17. ★ 기능을 쓰지 않을 때 동작 불변 보장 (FR-0-238 · 요구사항 §12 ④)

| 상황 | 불변 대상 | 장치 |
|---|---|---|
| 모든 챗봇 스위치 꺼짐(기본) · 규칙 0 | 공개 대화·설정 조회(쿼리 없음)·보류 폴링·상담 폴링·평가·시뮬레이터·TC·로그·통계·데이터 지도 | 대화 경로는 새 테이블을 읽지 않음 · 설정 조회는 쿼리 없으면 선제 분기 전 반환 · 지도 선택 키 생략 |
| 사이트 삽입 코드에 `data-proactive` 없음 | 위젯 요청 수·요청 바이트·타이머·리스너·`sessionStorage` 쓰기 | 선제 모듈 미초기화 · 기능 선언 배열 불변 · `noteUserSend` 훅 no-op |
| 구버전 위젯(캐시된 `widget.js`) | 요청·응답 전부 | 새 쿼리·새 경로를 부르지 않음 · 메시지 경로 무변경 |
| 신버전 위젯 + 구버전 서버 | 오류 없음 | 구버전 서버는 `?proactive=1`을 무시 → `proactive` 키 없음 → 위젯 종료 · 수집 경로 404는 무시 |
| 롤백(서버를 이전 커밋으로) | WEB 채널 설정·Origin 가드 | 채널 설정 스키마·값 무변경 — 새 테이블은 구버전이 모른다 |

---

## 18. 요구사항 추적표 (요약)

| 요구사항 | 이 문서 |
|---|---|
| FR-0-238 · AC-PA1-1·2·6 | §5.1 · §6.1 · §17 · §16 |
| FR-0-239 · AC-PA1-4 | §7 · PA-1 |
| FR-0-240 · AC-PA1-7 | §6.4 · PA-14 |
| FR-0-241 · FR-0-242 | §8 · PA-9 |
| FR-0-243 · AC-PA1-5 | §5.6 · X-1~X-6 |
| FR-0-244 · FR-0-245 · FR-0-246 | §12.2 · §3.5 · §6.8 |
| FR-0-247 · FR-0-250 | §6.4 · §13 |
| FR-0-248 · FR-PA7-\* | §12 |
| FR-0-249 | §16.3 |
| FR-PA1-1~9 · AC-PA2-\* | §4.1 · §9 |
| FR-PA2-1~3 · AC-PA3-1~3 | §4.2 · §6.2 |
| FR-PA3-1~7·9 · AC-PA3-5~10 | §6.4 · §6.5 |
| FR-PA4-1~7 · AC-PA4-1·2·4~7 | §5.2 · §6.2 · §6.3 · §6.6 |
| FR-PA5-1~8 · AC-PA5-1~6 | §5 |
| FR-PA6-1~6 · AC-PA6-\* | §11 |
| FR-PA8-\* · AC-PA8-\* | §13 |
| FR-PA9-1~4 · AC-PA9-\* | §10 |
| NFR-PAM1 | §4.2(브라우저 판정 1벌) · §5.2(서버 판정 — 서버 파일) |
| 범위 밖(P-2 축소) | §1.1 · §22 |

---

## 19. 알려진 제한

| # | 제한 | 완화 |
|---|---|---|
| K-1 | 탭마다 세션 상한이 따로 적용 · 새 탭·재방문이면 다시 뜰 수 있다(P-3 (a)) | 버튼 문구 "이번 방문 동안" · 재방문 불만 시 재검토 트리거 |
| K-2 | 통계는 브라우저 보고 기반 — 광고 차단·`keepalive` 실패·인스턴스별 중복 억제·재시작 시 중복 억제 소멸·위조 전송으로 실제와 다를 수 있다 | 참고치 상시 고지 · 전용 버킷 · 결합 검증 |
| K-3 | 해시 라우팅 SPA(`/#/order`)는 경로 조건으로 구분 불가(경로만 비교) | 삽입 안내에 명시 · `/**` 사용 |
| K-4 | 체류 시간은 위젯 부팅 시점부터(페이지 탐색 시작 아님) · 뒤로 가기 캐시(bfcache) 복원은 이어서 센다 | 수 초 차이 — 허용 |
| K-5 | 말풍선이 뜬 뒤 노드가 사라지고 클릭하면 폴백 응답(미응답으로 기록될 수 있음) | 캐시 없음 · 콘솔 경고 |
| K-6 | 서버·브라우저 시각 차이만큼 `showUntil` 조기/지연 | 허용(EX-PA-17) |
| K-7 | 콘솔 미리보기는 근사 렌더(위젯 DOM 재사용 아님 — ADR-0012 공유 범위) | 문구·색·배치만 일치 목표 |
| K-8 | 허용 도메인 목록이 나중에 좁아져도 기존 `LINK` 규칙은 공개 조회에서 걸러지지 않는다 | 목록 `LINK_OUTSIDE_POLICY` 경고 |
| K-9 | 수집·조회 요청은 `Content-Type: application/json`이라 프리플라이트가 붙는다(기존 `request()` 성질 · CORS `maxAge` 600 캐시) | — |
| K-10 | 휴대폰 가상 키보드 판단은 "호스트 입력 요소 포커스" 추정 | 기본 데스크톱만 |
| K-11 | 기존 위젯 요청(런처 클릭 후 설정·메시지·폴링)은 브라우저 기본 리퍼러 정책 그대로(같은 출처면 전체 주소) | 이 그룹 범위 밖 — 필요 시 별도 과제 |
| K-12 | 전체 화면 모드·`/c/:slug`에는 말풍선이 없다 | EX-PA-8 |
| K-13 | 요청 사실·시각·IP·UA는 네트워크 수준에서 보인다(리버스 프록시 로그) | 앱은 저장 안 함 · 운영 가이드 |
| K-14 | 규칙은 스냅샷 밖 — 버전 복원으로 되돌릴 수 없고 스테이징 버전 기준 미리보기가 없다 | 목록 문제 판정은 "서비스 중" 기준 |
| K-15 | 선제 사이트는 런처 클릭 시 설정 조회가 한 번 더 간다(선제 조회 결과를 재사용하지 않음) | 기존 열기 경로 불변을 우선(R-11) |
| K-16 | 신호 함수(`window.__ChatBotWidget.signal`)·연속 미응답 제안 없음 | §22 |

---

## 20. 요구사항 대비 해석 (architect 판단)

| # | 해석 |
|---|---|
| R-1 | P-2는 추천 (a)가 아니라 **(c) 페이지 머묾만**으로 확정됐다 — §1.1 항목은 이번 범위 밖이고 설계는 확장 자리(§22)만 둔다 |
| R-2 | 스위치 저장 위치 = 1:1 테이블(요구사항 §5.1의 두 선택지 중 후자) — EX-PA-18 롤백 위험이 실제로 보안 완화까지 이어짐을 코드로 확인(제약 ①) |
| R-3 | "우선순위(정수 — 높은 것 1개)"는 `position`(작을수록 우선 · 위/아래 이동)으로 구현 — 의미 동일, 동점 없음(EX-PA-3의 "생성 시각" 보조는 정렬 키에 포함) |
| R-4 | 복제는 새 경로 없이 콘솔 폼 채우기 — 용도 확인이 사람 행위로 남는다 |
| R-5 | 측정 사건은 추천 (a) 그대로 4종(표시·클릭·닫기·**끄기**). 사용자 표현 "표시·클릭·닫기"의 끄기는 "모든 안내 닫기"로 보아 별도 열로 둔다(끄기율 = 성가심 지표) |
| R-6 | "조건은 한 페이지에서 1번만 성립"(FR-PA2-3) = 한 페이지에서 **표시**는 1번. 일시 억제(패널 열림·간격)로 못 뜬 경우 같은 페이지에서 억제가 풀리면 뜰 수 있다 |
| R-7 | 수집 결합 검증은 게시 기간·시간대를 보지 않는다 — 경계 시각에 뜬 말풍선의 닫기·클릭을 잃지 않게. 켜짐·챗봇 일치·위젯 판정 종류는 본다 |
| R-8 | 수집 응답은 요구사항 "204(또는 고정 본문)" 중 **204** |
| R-9 | 노드 삭제 경고는 콘솔 계산(규칙 목록 재사용) — 대화 설계 API 변경 0 · `channel:read` 없는 편집자는 경고를 보지 못한다(비차단이므로 수용) |
| R-10 | `LIMIT_EXCEEDED`는 기존 사용례대로 400(AC-PA2-5 "409 또는 400") |
| R-11 | 선제 조회로 받은 설정을 런처 열기에 재사용하지 않는다 — 기존 `handleOpen` 경로·시험 불변 우선 |
| R-12 | 캐시 0초(FR-PA5-8 "값은 architect") |
| R-13 | "금지어 재사용 방식" = 기존 전역 금지어 사전(`BannedWordFilterService`)을 정책 무관하게 "일치 1건 이상 = 저장 거부/조회 제외"로 적용 — 선제 문구는 관리자 텍스트라 마스킹이 아니라 거부가 맞다 |
| R-14 | 표시 시간대 요일 체계 = `toKstWeekday()`(0=월) — 요구사항 "0~6"의 기준을 코드 기존 체계로 고정 |
| R-15 | `showLauncher=false` 사이트는 선제 코드가 조회 후 곧바로 종료(EX-PA-7) — 조회 1건은 발생한다(런처 숨김 여부를 조회 전에 알 수 없음) |
| R-16 | 말풍선의 "괜찮아요" 버튼(§1.12 예시)은 별도 버튼 종류가 아니라 항상 있는 "안내 닫기"로 대체 — 닫기가 버튼 3개와 별개로 항상 존재(FR-PA1-5) |
| R-17 | 버튼 0개 규칙의 본문은 버튼 요소로 만든다(키보드 도달 — FR-PA1-7 + NFR-PAA3) |
| R-18 | 휴대폰 판정 = 삽입 속성 `data-mode="mobile"`만(사용자 에이전트 판별 없음 — 기존 위젯 규약) |
| R-19 | 데이터 지도 세 행은 선택 키 1개(`proactive?`)를 콘솔이 세 행으로 렌더 |
| R-20 | 요구사항 FR-PA5-2의 "챗봇 단위 상한·간격" + FR-PA4-5의 조용한 시간 N분을 `caps.quietAfterUserMessageSec`로 서버 설정화(기본 300초) |

---

## 21. PM 확인이 필요한 구현 세부 (기본값으로 진행 가능)

아래는 **기본값으로 구현을 시작해도 되는** 항목이다. 이견이 있을 때만 조정한다.

| # | 항목 | 기본값 | 대안 |
|---|---|---|---|
| Q-1 | 콘솔 위치 | 채널 탭 웹 채널 영역 안 섹션(시험 기대값 변경 0) | 새 최상위 탭(`TabNav.spec` X-8) |
| Q-2 | 선제 조회 IP 한도 | 300/분(회사망 한 IP에서 분당 300 페이지 로드) | 대규모 사내망이면 상향 — 환경변수 |
| Q-3 | seed 예시 규칙 | 만들지 않음 | 꺼진 예시 1건 |
| Q-4 | "끄기"를 통계에 별도 열로 | 별도(R-5) | 닫기에 합산 |

---

## 22. 범위 밖 · 확장 여지 (P-2 · 요구사항 §9)

| 항목 | 붙이는 방법(참고 — 이번에 만들지 않음) |
|---|---|
| **사이트 신호 `HOST_SIGNAL`** | `ProactiveTriggerKind` +1 · 유니온 분기 `{ kind, signal: [a-z0-9_-]{1,32}, pathInclude?, pathExclude? }` · `PROACTIVE_WIDGET_TRIGGER_KINDS` +1 · 위젯 `window.__ChatBotWidget.signal(name)`(이름만 · 규칙 불일치 무시 · 로드 전 호출 무시 — EX-PA-13) · 판정기 1개. 서버 공개 표면 변화 0 |
| **대화 중 연속 미응답 `UNANSWERED_STREAK`** | 서버 전용 규칙(공개 조회 제외 목록) · `public-conversation.service.ts` 로그 적재 뒤가 아니라 **응답 조립 전** 판정 — `handoff/lib/session-alert.ts` `evaluateSessionAlert` 1벌(No.24·No.41 수치 일치) · 스위치 켜짐 ∧ 규칙 있음일 때만 쿼리(NFR-PAP2) · 공개 메시지 응답 선택 키(예: `proactiveOffer?` — `feedback`이 "마지막 키" 규약이므로 그 **앞**에 두거나 `feedback` 규약 갱신) · 위젯 기능 선언 `proactive-v1`(4/5) · 상담 관찰 키와 공존(EX-PA-19) · ADR-0045 갱신 각주 필요(대화 경로 변경) |
| 스크롤·이탈 트리거 | 판별 유니온 분기 + 판정기 |
| 며칠 닫음 기억 | `localStorage` — 위젯 원칙 변경 · 법무 · 별도 ADR |
| 서버 이벤트·식별 고객·예약(규모 B) · 외부 채널(규모 C) | ADR-0045 재검토 트리거 |
| 그룹·전역 선제 통계 · No.41 이벤트 발송 · 규칙 복사 · 다국어 문구 · A/B | 요구사항 §9 |

---

## 23. GPU · 배포 형태 (P-10)

GPU **1**(카탈로그 3 → 1) — 문자열·숫자 비교·타이머·DB 카운터뿐 · 추론·임베딩·LLM 0 · `apps/ml-worker` 0. 개발(RTX 3050 4GB)·운영(L40S) 모두 GPU 미사용. 구축형 ○(외부 의존 0 · 인터넷 불필요) · 구독형 ○.

---

## 24. 구현 편차 기록 (I-n)

(구현 후 system-architect가 기록 — 번들 실측 · 골든 캡처 커밋 · 기대값 변경 실제 목록 대조 등)
