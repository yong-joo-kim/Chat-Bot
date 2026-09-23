# ADR-0016 — 감사로그 소급 범위 · 기록 단위 · 기록 위치와 트랜잭션 경계

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-21 (§7 보칙 추가: 2026-09-21)
- **결정자**: system-architect
- **관련**: `docs/requirements/security-audit.md` **J-4**, **J-5**, FR-0-26, FR-0-27, FR-13-1 ~ FR-13-24, NFR-P3/P4/P5/P7, NFR-S8/S11, NFR-M1/M3/M7, AC-13-1~17, EX-13-1~12 / `ADR-0004`(집계 전략 · 소비자 없는 구조 금지) / `ADR-0013`(마스킹은 서비스 내부 1곳) / `ADR-0007`(인터페이스 추상화로 교체 지점 1곳)
- **영향 범위**: `apps/api/prisma/schema.prisma`(`AuditLog`), `apps/api/src/audit-logs/**`, `apps/api/src/common/request-context/**`, **9개 도메인 서비스(40개 쓰기 메서드)**, `packages/shared-types/src/audit.ts`
- **세부 설계**: `docs/02-spec/security-audit-설계.md` §9

## 맥락

`AuditLog` 테이블은 Phase 0부터 존재했지만 **쓰기 코드가 0줄**이다(`apps/api/src` 전체에 `auditLog` 문자열이 1회도 없다). 그동안 만든 9개 도메인 모듈(`chatbot-groups`/`chatbots`/`intents`/`keywords`/`homonyms`/`contexts`/`dialog-nodes`/`faqs`/`channels`)의 등록·수정·삭제가 **한 건도 기록되지 않았다.**

여기서 결정해야 할 것이 네 가지다.

1. **소급할 것인가** — 이번 그룹이 만드는 3개 메뉴(회원/금지어/이력)만 기록할 것인가, 기존 9개 모듈 전체에 소급할 것인가.
2. **어디서 기록할 것인가** — 각 서비스가 명시 호출할 것인가, Nest 인터셉터로 자동 기록할 것인가.
3. **`actor`를 어떻게 전달할 것인가** — 9개 모듈 40개 메서드의 시그니처를 바꾸지 않고 "누가 했는지"를 서비스에 전달해야 한다(NFR-M7).
4. **트랜잭션 경계는 어디인가** — FR-13-12는 "본 동작과 같은 트랜잭션"을 권고하는데, FR-13-13은 "기록 실패가 본 동작을 실패시켜서는 안 된다"고 한다. **두 요구는 트랜잭션 내부 기록에서 서로 모순된다.**

추가로 기준 목록 No.13은 "레거시 API 연동 상세 로그"를 같은 항목에 묶어 두었고, 개발명세서 §3의 `AuditLog` 설명도 "변경 이력 + API 연동 상세로그"로 되어 있다. 이것을 같은 테이블에 담을 것인지도 정리해야 한다.

## 결정

### 1. 기존 9개 도메인 모듈 **40개 쓰기 지점에 전면 소급한다** (J-4)

| 모듈 | 기록 지점 |
|---|---:|
| `chatbot-groups` | 4 |
| `chatbots` | 8 |
| `intents` | 6 |
| `keywords` | 5 |
| `homonyms` | 3 |
| `contexts` | 3 |
| `dialog-nodes` | 4 |
| `faqs` | 5 |
| `channels` | 2 |
| **합계** | **40** |

지점별 `action`/`targetType`/`targetName`/`chatbotId` 매핑은 `security-audit-설계.md` §9.5의 표가 **구현 체크리스트**다.

**범위 통제 장치 4종**(이것이 없으면 소급은 위험한 결정이다):

- 기록 대상은 **쓰기 API만**이다. 조회·시뮬레이션·비교·임포트 dry-run·공개 대화는 기록하지 않는다.
- **대량 작업은 행당 1건이 아니라 배치 1건 + 요약**이다(`BULK_DELETE`/`IMPORT`). 5,000행 임포트가 이력 1건이 된다(AC-13-5, NFR-P4).
- `beforeValue`/`afterValue`는 전체 덤프가 아니라 **도메인별 허용 필드 화이트리스트 스냅샷**이며 8KB 상한 + 절단 표기다. 대량 필드는 **원문이 아니라 건수**로 기록한다(`examples`→`exampleCount`). **단, 요약 액션(`BULK_DELETE`/`IMPORT`)은 화이트리스트 대상이 아니다 — §7 참조.**
- **기록 실패가 본 동작을 실패시키지 않는다**(§4). 소급이 기존 75개 API의 가용성을 떨어뜨리지 않게 하는 안전장치다.

### 2. 기록 위치 — 각 서비스가 `AuditLogService.record()`를 **명시 호출**한다. 인터셉터 기각 (DD-38)

```ts
class AuditLogService {
  async record(input: {
    action; targetType; targetId; targetName?; chatbotId?;
    before?; after?; summary?; actorOverride?;
  }): Promise<void>;   // ← 전체가 try/catch. 예외를 삼키고 warn만 남긴다
}
```

- **`prisma.auditLog.create`를 이 서비스 밖에서 호출하지 않는다**(NFR-M3). 스냅샷 화이트리스트·절단·민감정보 차단이 **이 함수 내부 단 1곳**에서 일어난다 — `ConversationLogService`가 PII 마스킹을 내부에서 수행하는 것(ADR-0013)과 동일한 구조적 안전장치다. 호출부가 "무엇을 기록하면 안 되는지" 기억해야 하는 설계는 반드시 잊힌다.
- 컨트롤러·매퍼·`lib/`는 감사로그를 알지 못한다(FR-0-27).
- **명시적 예외 1건**: 인증·인가 이력(`LOGIN`/`LOGIN_FAILED`/`LOGOUT`/`PERMISSION_DENIED`)은 `AuthService`와 `PermissionGuard`가 기록한다. 권한 거부는 **가드 외에 관측 지점이 없다**. 이 예외를 개발명세서 §2.1에 명문화한다.

### 3. `actor` 전달 — `AsyncLocalStorage` 요청 컨텍스트 (DD-40, FR-0-26, NFR-M7)

```ts
// common/request-context/ — 미들웨어가 전 요청을 als.run()으로 감싸고, 가드가 인증 후 actor를 주입한다
interface RequestContext { actor: AuthenticatedActor | null; ip?; userAgent?; requestPath: string }
```

**규약 3건**

1. `RequestContextService.get()`을 호출해도 되는 곳은 **`AuditLogService` 1곳뿐**이다. 도메인 서비스가 직접 호출하면 "숨은 전역 상태"가 되어 기각한 대안들과 같은 문제가 생긴다.
2. 컨텍스트가 비어 있어도(배치·seed·테스트) **예외를 던지지 않는다.** `actorId=null` + `actorEmail='system'`으로 기록한다(FR-13-10).
3. `@CurrentUser()` 데코레이터는 **컨트롤러 전용**이다. actor가 **비즈니스 인자**인 경우(본인 비밀번호 변경, 자기수정 판정)에는 서비스 시그니처에 `actorId`를 명시적으로 넘긴다 — 감사용 암묵 전달과 비즈니스 인자를 섞지 않는다.

### 4. 트랜잭션 경계 — **본 동작 커밋 직후 별도 쓰기**로 통일한다 (DD-41)

FR-13-12와 FR-13-13의 모순을 다음과 같이 해소한다.

| 요구 | 충족 방식 |
|---|---|
| FR-13-12 "본 동작이 롤백되면 이력도 남지 않아야 한다" | **충족.** 커밋 후에만 기록하므로 롤백된 변경은 애초에 기록되지 않는다. AC-13-14(유효성 오류 요청은 이력 없음)도 자동 충족 |
| FR-13-13 "기록 실패가 본 동작을 실패시키지 않는다" | **충족.** 별도 쓰기이므로 실패를 삼켜도 본 동작에 영향이 없다 |
| 역방향 결손(본 동작 성공 + 기록 실패) | **수용한다.** FR-13-13이 명시적으로 허용한 트레이드오프이며 경고 로그로 관측된다 |

- `beforeValue`는 **변경 전에 캡처**한다. 대부분의 쓰기 메서드가 이미 존재 확인용 `findUnique`를 수행하고 있어 추가 조회가 거의 필요 없다.
- 기록은 **`await` 한다**(대화로그의 `void ...`와 다르다). 관리자 API는 저지연 요구가 낮고(목록 300ms 예산), 감사 기록은 "남았는지"가 기능 자체다. INSERT 1건이라 NFR-P3(20% 이내)에 여유가 크다.

### 5. `AuditLog`와 `ApiCallLog`를 분리한다 (J-5, DD-47)

- 이번 Phase에 **`ApiCallLog`를 만들지 않는다.** 기록 대상인 No.26(레거시 API 연동)이 미구현이고 `API_CONDITION` 아웃풋은 실행조차 되지 않는다(ADR-0008). **쓰기 주체 없는 스키마 금지**(ADR-0004).
- **개발명세서 §3의 `AuditLog` 설명에서 "API 연동 상세로그"를 삭제**하고, No.26 착수 시 별도 테이블로 설계함을 명시한다.
- 근거: 두 로그는 **성격이 다르다.** 감사로그는 "누가 무엇을 바꿨나"(저용량·장기보존·요약·불변), API 로그는 "외부 호출 원문"(고용량·단기보존·Header에 토큰/PII 포함 가능)이다. 한 테이블에 섞으면 보존기간·마스킹·인덱스 전략이 서로를 방해한다.

### 6. 인덱스는 4종 중 **3종만** 만든다

`@@index([createdAt])` · `@@index([actorId, createdAt])` · `@@index([chatbotId, createdAt])` 채택, **`@@index([targetType, targetId, createdAt])` 기각**. 이번 Phase의 어떤 AC도 `targetId`로 조회하지 않으며, 이는 ADR-0004의 "소비하는 수용기준이 없는 구조는 만들지 않는다" 기준에 걸린다. `AuditLog`는 무한 증가하는 유일한 테이블이므로 인덱스 1개가 **모든 관리자 쓰기 동작**에 비용을 더한다. 재검토 트리거는 No.25(버전 이력)가 "이 리소스의 변경 이력" 화면을 만들 때다.

### 7. 요약 액션(`BULK_DELETE`/`IMPORT`)은 화이트리스트 대상이 아니다 (보칙 · 2026-09-21 추가)

**배경.** FR-13-11(도메인별 허용 필드 화이트리스트)과 `security-audit-설계.md` §9.6의 대량 요약 포맷(`{created, updated, deleted, targetIds, truncated}`)이 서로 충돌한다. 요약 객체의 키는 **도메인 엔터티 필드가 아니므로** `buildSnapshot(targetType, ...)`을 그대로 통과시키면 전부 걸러져 `afterValue`가 `{}`가 된다 — FR-13-5 / AC-13-5·6(대량 작업 1건 요약)이 성립하지 않는다. 최초 결정(§1 범위 통제 장치 3번째 항목)이 이 경우를 명시하지 않아 구현 단계에서 드러났다.

**결정.** `AuditLogService.record()`는 `action`이 **`BULK_DELETE` 또는 `IMPORT`**일 때 화이트리스트 스냅샷 변환을 **건너뛰고**, 서비스가 구성한 요약 객체를 그대로 저장한다. **화이트리스트 대신 고정 요약 스키마 자체가 필드 제한 역할을 한다.**

**이 예외가 NFR-S8을 깨지 않는 이유** — 요약 객체에 허용되는 값의 종류가 구조적으로 제한되기 때문이다.

| 키 | 값 종류 | PII·원문 유입 가능성 |
|---|---|---|
| `created` / `updated` / `deleted` | number(건수) | 없음 |
| `targetIds` | 엔터티 **UUID 배열**(최대 `AUDIT_LIMITS.bulkTargetIds`=50) | 없음 — 이름·본문 등 표시용 문자열을 섞지 않는다 |
| `truncated` | boolean | 없음 |
| `fileName`(선택) | 업로드 **원본 파일명**만. 파일 **내용**은 어떤 형태로도 넣지 않는다 | 없음 |
| `summary`(별도 컬럼) | 건수 + 고정 라벨 한 줄(`"대량 등록 / 의도 / 신규 4,812건·갱신 188건"`) | 없음 — 대상 이름 나열 금지 |

- 요약 액션에는 **`targetName`을 설정하지 않는다**(대량 대상에 대표 이름이 성립하지 않는다).
- **8KB 상한·절단(`serializeSnapshot`)은 요약 액션에도 동일하게 적용**된다. 우회되는 것은 화이트리스트 한 가지뿐이다.
- 예외 분기는 `AuditLogService.record()` **내부 1곳**에만 존재한다 — NFR-M3("민감정보 차단이 단 1곳") 원칙은 유지된다. 요약 액션을 추가할 때는 이 분기와 설계서 §9.6을 함께 갱신한다.
- 화이트리스트를 요약 키까지 확장하는 대안(`AUDIT_FIELDS`에 `created`/`updated`/... 추가)은 **기각**한다. 도메인 스냅샷 화이트리스트가 "엔터티 필드 목록"이라는 의미를 잃고, 12개 `targetType` 전부에 요약 키를 중복 나열해야 하며, 단건 CRUD 스냅샷에도 요약 키가 통과할 수 있는 구멍이 생긴다.

**검증 결과(2026-09-21, 코드 대조).** 요약 액션 호출부 6곳 — `intents.service.ts`(`bulkDelete`/`importCommit`), `keywords.service.ts`(동), `faqs.service.ts`(동) — 의 `after` 객체는 전부 **건수(number) + UUID 배열 + boolean**만 담고 있으며, 질문/답변/예문/동의어 원문이나 개인정보가 섞이는 경로는 없다. `targetId`도 UUID다. **NFR-S8 위반 없음.**

**인계.** `code-reviewer` 점검 항목 추가: 요약 액션 호출부 6곳의 `after` 객체가 위 표의 값 종류 외의 것을 담지 않는지 전수 확인. `test-automation` 점검 항목 추가: AC-13-17(PII·원문 부재) 검증을 `BULK_DELETE`/`IMPORT` 경로에도 적용.

## 근거

- **감사로그는 백필이 불가능하다.** 과거 변경 내역은 DB 어디에도 남아 있지 않다. 소급을 다음 Phase로 미루면 **그 기간의 이력이 영구히 존재하지 않는다.** 이는 "나중에 추가하면 되는" 다른 기능과 성격이 근본적으로 다르다 — 미루는 비용이 **시간에 비례해 회복 불가능하게** 누적된다.
- **설계 원칙이 이미 그렇게 세워져 있다.** 개발명세서 §2.1은 서비스 계층을 "비즈니스 규칙의 단일 진입점(**향후 `AuditLog` 기록 지점**)"으로 명시했고, `quality-channel.md` FR-11-13도 채널 서비스를 같은 문구로 설계했다. 소급하지 않으면 이 설계 의도가 실현되지 않은 채 남는다.
- **지금이 가장 싸다.** 모듈은 앞으로만 늘어난다(No.14/15 + 확장기능 14종). 9개일 때와 20개일 때의 비용 차이가 크고, 그 사이 기간의 이력은 영구 결손된다.
- **"전 메뉴"가 기능 정의 자체다.** 이번 그룹이 만든 3개 메뉴만 기록하면, 관리자가 이력 화면을 열었을 때 **정작 궁금한 챗봇·대화 자산 변경이 하나도 없는** 빈 껍데기가 된다(S-13).
- **인터셉터를 기각한 이유는 세 가지다.** ① `beforeValue`(변경 전 상태)를 얻을 수 없다 — 인터셉터는 핸들러 실행 전후만 알고 도메인 상태를 모른다. ② `targetType`/`targetId` 추론이 **경로 문자열 파싱**에 의존해 취약하다(`/chatbots/:chatbotId/intents/:id`에서 무엇이 대상인가?). ③ 대량 작업 요약(`IMPORT` 5,000행 → 1건 + 건수 내역)을 응답 본문에서 역추론해야 한다. 40곳을 수정하는 비용은 크지만 **한 번 내는 비용**이고, 잘못된 기록은 **영구히 잘못된 채 남는다.**
- **요청 스코프 provider를 기각한 이유**: Nest의 `Scope.REQUEST`는 **의존성 트리를 타고 전파된다.** `AuditLogService`가 요청 스코프가 되면 그것을 주입하는 9개 도메인 서비스가 전부 요청 스코프가 되고, 다시 그 서비스들이 주입하는 `DialogueBundleService`·`RateLimitStore`까지 요청마다 재생성된다. **번들 캐시(DD-22)와 레이트리밋 카운터(DD-23)가 무력화**되어 ADR-0007/ADR-0011의 설계가 조용히 무너진다 — 테스트로 잡히지 않고 성능 저하로만 나타나는 종류의 회귀다.
- **커밋 후 기록이 옳은 이유**: 트랜잭션 안에서 기록 실패를 삼키려면 예외를 잡아야 하는데, 그러면 오염된 트랜잭션으로 커밋을 시도하게 된다. Postgres에서는 `current transaction is aborted`로 **본 동작까지 실패**한다 — 개발명세서 §6-4가 예정한 전환이므로 지금 SQLite에서 동작한다는 것은 근거가 되지 않는다. 반면 커밋 후 기록은 FR-13-12의 **목적**(롤백된 변경이 이력에 남지 않을 것)을 완전히 달성한다.
- **`targetName`/`actorEmail`/`actorRole` 스냅샷이 없으면 기능이 성립하지 않는다.** 대상이 삭제되거나 이름이 바뀌면 이력 목록이 **UUID 나열**이 되어 사용 불가능해진다(AC-13-15, EX-13-7). "로그는 그 시점의 사실 기록"이라는 기존 판단(`ConversationLog` FK 예외 조항)과 일치한다.
- **요약 액션 예외의 근거(§7)**: 화이트리스트의 **목적**은 "엔터티 원문·PII가 감사 경로로 새지 않게 하는 것"이지 "모든 JSON을 걸러내는 것"이 아니다. 요약 객체에는 애초에 엔터티 필드값이 없으므로 걸러낼 대상이 존재하지 않으며, 그대로 적용하면 목적은 얻지 못한 채 기능만 소멸한다. **값의 종류를 제한하는 고정 스키마**가 같은 목적을 더 강하게 달성한다(number·UUID·boolean만 허용은 필드명 화이트리스트보다 좁은 제약이다).

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **이번 그룹 신규 3개 모듈만 기록, 9개 모듈은 다음 Phase** | 그 기간의 이력이 **영구 결손**된다. 이력 화면이 빈 껍데기가 되어 No.13의 수용기준을 실질적으로 만족하지 못한다 |
| **Nest 인터셉터 자동 기록** | `beforeValue` 불가, `targetType` 추론이 경로 파싱 의존, 대량 요약 역추론 필요. 기록 내용이 부정확하면 감사로그의 가치가 0이다 |
| **Prisma 미들웨어(`$extends`)로 모든 쓰기 자동 기록** | 암묵 동작이라 디버깅이 어렵고, 조인 테이블 쓰기(`DialogNodeIntent`)까지 이력이 되어 노이즈가 폭증한다. 대량 작업을 배치 1건으로 묶을 수 없다. "어떤 필드가 민감한가"를 미들웨어가 알 수 없다(ADR-0013이 같은 이유로 기각한 대안) |
| **모든 서비스 메서드에 `actor` 파라미터 추가** | 변경 표면이 40 서비스 메서드 + 75 컨트롤러 핸들러 + 기존 단위·통합 테스트. **회귀 위험이 이번 그룹 최대 리스크**가 된다(NFR-M7이 명시적으로 금지) |
| **요청 스코프 provider(`Scope.REQUEST`)** | 싱글턴 캐시·레이트리밋 카운터를 파괴한다(위 근거) |
| **서비스가 `Request` 객체를 주입** | 개발명세서 §2.1 계층 규약 위반(서비스의 HTTP 개념 의존 금지), FR-0-26 정면 위반 |
| **트랜잭션 내부 기록(FR-13-12 문자 그대로)** | FR-13-13과 모순되고, Postgres 전환 시 본 동작까지 실패시킨다 |
| **비동기 큐로 감사 기록 적재** | 큐 인프라(Redis/BullMQ)는 확장기능 Phase 도입 예정이다(개발명세서 §6-4). 교체 지점이 `AuditLogService` 1곳이므로 필요해지면 그때 바꾼다 |
| **행당 1건 기록(대량 작업 포함)** | 5,000행 임포트가 이력 5,000건이 되어 화면이 사용 불가가 되고(S-14), NFR-P4(행 수 비례 지연 없음)를 위반한다 |
| **`beforeValue`에 엔터티 전체 덤프** | 8KB 상한을 상시 초과하고, 대화 원문·PII가 감사 경로로 유입된다(NFR-S8). ADR-0013의 마스킹 정책을 우회하는 구멍이 된다 |
| **요약 키를 `AUDIT_FIELDS` 화이트리스트에 추가(§7 대안)** | `AUDIT_FIELDS`가 "엔터티 필드 목록"이라는 의미를 잃고, 12개 `targetType` 전부에 요약 키를 중복 나열해야 하며, 단건 CRUD 스냅샷에도 요약 키가 통과하는 구멍이 생긴다 |
| **요약 전용 `targetType`(예: `BulkOperation`) 신설(§7 대안)** | `targetType`이 "Prisma 모델명과 1:1"이라는 §9.3 규칙이 깨지고, 챗봇/대상별 이력 필터에서 대량 작업이 도메인과 분리되어 보이지 않게 된다 |
| **`AuditLog`에 API 연동 로그를 함께 적재** | 보존기간(장기 vs 단기)·용량(KB vs MB)·마스킹 요건(요약 vs Header 토큰)이 충돌한다. 인덱스 전략도 서로를 방해한다 |
| **조회(READ) 이력도 기록** | 기준 목록 13번은 "**등록/수정/삭제** 이력"이다. 75개 핸들러 중 32개가 조회라 볼륨이 수십 배가 된다 |
| **보존기간 정책·아카이브 배치를 지금 도입** | 보존기간은 법무/고객사 요건이며(금융 5년·공공 3년 등 상이) 미확정이다. 배치는 스케줄러 인프라를 새로 끌어온다. **무한 보존 + 조회 기간 상한**으로 운영 가능하게 하고 운영 리스크로 명시한다 |

**감수하는 비용**

1. **9개 모듈 40곳을 수정한다.** 메서드당 1~2줄이지만 누락 가능성이 실재한다 → §9.5 표를 체크리스트로 쓰고, AC-13-7(모듈별 최소 1케이스)을 테스트로 고정하며, `code-reviewer`가 쓰기 메서드를 전수 대조한다.
2. **기존 API의 응답시간이 INSERT 1건만큼 늘어난다.** NFR-P3(20% 이내)을 AC-13-16으로 측정한다.
3. **`AsyncLocalStorage`는 암묵 전달**이라 "actor가 어디서 왔는지"가 코드에 드러나지 않는다 → 접근 지점을 `AuditLogService` 1곳으로 제한하고 `code-reviewer` 점검 항목으로 둔다.
4. **역방향 결손**(본 동작 성공 + 기록 실패)이 가능하다 → FR-13-13이 명시적으로 허용했으며, 경고 로그로 관측된다.
5. **`beforeValue`가 부분 스냅샷이라 이력으로 복원할 수 없다** → 복원은 No.25(챗봇 복원/버전 이력관리)의 본체이며, `beforeValue`로 되돌리기를 제공하면 그 설계를 선점하게 된다.
6. **이력 테이블이 무한 증가한다** → 운영 리스크로 명시(EX-13-9), 보존기간 정책은 No.45로 이관. 조회 기간 상한(기본 30일·최대 90일)으로 조회 성능은 방어된다.
7. **요약 액션은 화이트리스트 강제가 아니라 호출부 규약에 의존한다**(§7) → 값 종류를 number·UUID·boolean으로 못 박고, 호출부 6곳을 `code-reviewer` 전수 점검 항목으로 고정한다. 요약 액션은 6곳뿐이고 새로 늘어날 때만 재점검하면 된다.

## 결과

- Prisma `AuditLog`: `actorEmail`·`actorRole`·`targetName`·`chatbotId`·`summary`·`ip`·`userAgent` 추가, 인덱스 3종 추가, **FK는 걸지 않는다**(`ConversationLog`와 동일한 의도적 예외 — FK를 걸면 이력이 쌓인 챗봇을 영원히 삭제할 수 없다).
- `apps/api/src/audit-logs/`: `audit-log.service.ts`(**record() 단일 진입점**) / `audit-logs.service.ts`(조회 전용) / `audit-logs.controller.ts`(**조회 3개, 쓰기·삭제 경로 없음**) / `lib/{audit-snapshot.ts, audit-diff.ts, audit-range.ts}`(순수 함수, NFR-M1).
- `apps/api/src/common/request-context/`: `AsyncLocalStorage` 래퍼 + 미들웨어 + `@Global()` 모듈.
- **9개 도메인 서비스 40곳**에 `record()` 호출 삽입(§9.5 표).
- `AuditLogService.record()`에 **요약 액션 분기 1곳**(`BULK_DELETE`/`IMPORT` → 화이트리스트 미적용, §7).
- `packages/shared-types/src/audit.ts` 신설: `AuditAction`(12종)·`AuditTargetType`·라벨 상수·목록/상세/쿼리 스키마·`AUDIT_LIMITS`.
- `ApiErrorCode` 추가: `AUDIT_RANGE_TOO_WIDE`.
- 환경변수 추가: `AUDIT_QUERY_MAX_RANGE_DAYS`(기본 90).
- **개발명세서 §3 정정**: `AuditLog` 설명에서 "API 연동 상세로그" 삭제, No.26의 `ApiCallLog`로 이관 명시.
- seed: **감사로그를 만들지 않는다.** 실제 동작으로만 생성되어야 "기록되고 있음"을 증명할 수 있다(NFR-M5).
- `test-automation` 인계: ① **AC-13-7 — 9개 모듈 각각의 생성/수정/삭제가 기록되는지(소급 완료 증명)** ② AC-13-4(`DELETE` vs `PURGE` 구분) ③ AC-13-5/6(대량 작업 1건 요약) ④ AC-13-13(기록 실패해도 본 동작 성공) ⑤ AC-13-14(롤백된 요청은 이력 없음) ⑥ AC-13-17(`before`/`after`에 PII·비밀번호·대화원문 없음 — **`BULK_DELETE`/`IMPORT` 경로 포함**) ⑦ AC-13-16/NFR-P3(소급 후 성능 회귀 측정) ⑧ AC-13-11(10만 건에서 목록 P95 1초).
- `code-reviewer` 인계: ① `AuditLogService` 밖의 `auditLog.create` 호출 0건 ② **9개 모듈 쓰기 메서드 전수 대조(누락 0건)** ③ `RequestContextService.get()` 호출이 `AuditLogService` 1곳인지 ④ 이력 수정/삭제 경로 부재(컨트롤러에 `Patch`/`Delete` import 없음) ⑤ `before`/`after`에 화이트리스트 밖 필드가 들어갈 경로가 없는지 ⑥ **요약 액션 호출부 6곳의 `after`가 number·UUID 배열·boolean 외의 값을 담지 않는지**(§7).


---

## 갱신 (2026-09-23 — `AuditTargetType`에 `TestCaseSet` 추가)

검증/품질 고도화가 **`TestCaseSet` 1종**을 감사 대상에 추가한다. TC 세트는 **관리자가 만들어 다수 인원이 공유하는 자산**이며 "누가 기대값을 바꿨나"가 통제 대상이다. 세트 CRUD는 표준 `CREATE`/`UPDATE`/`DELETE`로, **개별 TC 편집은 소속 세트의 `UPDATE`로** 기록하고, **대량 임포트는 배치 1건 + 요약**(이 ADR의 기존 규약 그대로)이다.

**실행·취소·고정·비교는 감사 대상이 아니다.** 읽기 연산이고 자산을 바꾸지 않으며, 기록하면 실행 1회당 감사 1건이 쌓인다(FR-15-35의 큐 상태 변경, FR-L2-25의 분류기 학습과 **같은 판단**). 또한 실행 결과에는 **관리자가 작성한 문장만** 들어가므로 NFR-S8(감사로그에 사용자 발화 유입 금지)과는 무관하다.


---

## 갱신 (2026-09-23 — `RESTORE` 요약 액션 · `ChatbotVersion` 대상 · actor 스냅샷 읽기)

챗봇 복원/버전 이력관리(No.25, ADR-0031)가 다음을 추가한다. **감사로그의 결정(append-only · 커밋 후 기록 · 화이트리스트 부분 스냅샷 · 복원 원천이 아님)은 전부 불변**이며, 감수비용 5("`beforeValue`로 복원할 수 없다 — 복원은 No.25의 본체")는 **예고대로 No.25가 별도 저장소(`ChatbotVersion`)로 이행**했다.

1. **`AuditAction`에 `RESTORE`(12 → 13종, 라벨 `'복원'`)를 추가하고 `DESTRUCTIVE_AUDIT_ACTIONS`에 포함**한다. `targetType='Chatbot'`, `summary` 예: `"v27로 복원 (백업 v28) — 의도 +0/−0/~1, FAQ +0/−3/~0"`.
2. **`RESTORE`는 §7의 요약 액션**이다 — `record()`의 요약 분기(`BULK_DELETE`/`IMPORT`)에 `RESTORE`를 더해 화이트리스트를 건너뛴다. `after`는 `{ fromVersionNo, backupVersionNo, counts: { <종류>: { added, removed, modified } } }`로 **number만** 담는다(§7 표의 값 종류 제약 그대로 — 원문·이름 없음). **복원이 바꾼 개별 항목 수백 건을 감사 레코드로 풀어 쓰지 않는다**(행당 1건 기록을 기각한 §대안과 같은 판단). 요약 액션 호출부는 6곳 → **7곳**이며 code-reviewer 전수 점검 대상에 포함한다.
3. **`AuditTargetType`에 `ChatbotVersion`(라벨 `'챗봇 버전'`)을 추가**한다 — 수동 저장(`CREATE`)·라벨/메모 수정·고정/해제(`UPDATE`)·수동 삭제(`DELETE`). `AUDIT_FIELDS.ChatbotVersion = ['versionNo','trigger','label','memo','pinned','sizeBytes']`.
4. **자동 스냅샷 생성과 보존 정리, 복원 직전 백업 생성은 기록하지 않는다** — 자동 생성은 이미 감사되는 본 동작(`IMPORT`·`BULK_DELETE`·`Intent UPDATE`)의 부수 효과이고, 정리는 시스템 동작이며, 백업 번호는 `RESTORE` 요약에 포함된다. 기록하면 대량 작업마다 감사가 2배가 된다(FR-15-35·ADR-0029 §5와 같은 판단).
5. **`AuditLogService.currentActorSnapshot(): { id, email, role } | null` 공개 메서드를 추가**한다. 스냅샷 메타의 `createdById`/`createdByEmail`은 이 메서드로만 얻는다 — **`RequestContextService.get()` 호출 지점은 여전히 `AuditLogService` 1곳**이다(§결과 code-reviewer 점검 ③ 유지).
6. 버전 이력은 감사로그를 **복제하지 않는다** — "두 버전 사이의 감사 레코드"는 `(chatbotId, createdAt)` 인덱스로 **건수만** 세고 이력관리 화면으로 필터 링크를 건다(`audit:read` 전용 경로). **§6의 `(targetType, targetId, createdAt)` 인덱스 재검토 트리거는 발동하지 않는다** — No.25는 `targetId`로 조회하지 않으며, 항목별 변경 이력 화면은 1차 범위 밖이고 만들더라도 **스냅샷 차이**로 구현한다.


---

## 갱신 (2026-09-23 — `DeploySchedule` 대상 · 예약 실행의 주체 = 예약자(`actorOverride`))

운영 예약 배포(No.28, ADR-0032)가 다음을 추가한다. **감사로그의 결정(append-only · 커밋 후 기록 · 화이트리스트 부분 스냅샷 · ALS actor 전달 · `RequestContextService.get()` 호출 지점 1곳)은 전부 불변**이다.

1. **`AuditTargetType`에 `DeploySchedule`(라벨 `'배포 예약'`, 14 → 15종)** — 예약 생성 `CREATE` · 시각/메모 수정 `UPDATE` · 취소(`summary: "예약 취소"`)·보류 해제(`"보류 해제"`) `STATUS_CHANGE`. `AUDIT_FIELDS.DeploySchedule = ['action','status','scheduledAt','targetVersionNo','memo']`. **`AuditAction`은 추가하지 않는다.**
2. **예약 실행은 기존 액션으로 기록한다** — 복원 `RESTORE`(요약 액션 그대로) · 공개 `STATUS_CHANGE` · 채널 `UPDATE｜CREATE`. summary에 `[예약 실행 #<id 앞 8자>]` 접두를 붙인다.
3. **주체 = 예약자.** 예약 실행은 요청 밖(타이머)이라 ALS에 actor가 없다 — 그대로 두면 `actorEmail: 'system'`이 되어 **누가 반영했는지가 사라진다**. 실행 직전 재검증을 통과한 예약자를 `actorOverride`로 넘긴다. `actorOverride`의 용도는 "인증되지 않은 주체를 기록해야 하는 auth 경로"에서 **"요청 컨텍스트가 없는 경로의 명시 주체 전달(auth · 예약 실행기)"** 로 넓어진다. ALS를 읽는 곳은 여전히 `AuditLogService` 1곳이며, 예약 실행기는 ALS를 흉내 내지 않고 **인자로** 주체를 넘긴다. `ip`/`userAgent`는 `null`이다.
4. **기록하지 않는 것**: 예약의 NOOP(이미 그 상태) · FAILED · MISSED · HELD 전이 · 임대 만료 회수 판정 · "확인 필요" 해제 — 쓰기가 없거나 시스템 동작이다(자동 스냅샷·보존 정리 비감사와 같은 판단). 결과는 예약 행과 서버 경고 로그에 남는다. 규제 고객이 "실행되지 않은 사실"의 감사를 요구하면 No.45에서 재검토한다.
5. **커밋 직후~감사 기록 전 크래시 시 누락 가능성**은 §4의 "커밋 후 별도 쓰기"가 원래 갖는 성질이며 예약 실행도 같다 — 임대 회수가 감사를 사후 보정하지 않는다(공개 전환은 "우리가 썼는가"를 증명할 수단이 없어 보정하면 잘못된 주체를 남길 수 있다).
