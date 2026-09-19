# ADR-0006 — 정규화 기준 이름 유일성을 `*Normalized` 컬럼 + 유니크 인덱스로 강제

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/dialogue-design.md` §5.2 DD-4, FR-0-12, FR-0-13, FR-6-2, FR-7-3, FR-9-4, AC-6-2, AC-9-2
- **영향 범위**: `apps/api/prisma/schema.prisma`, `packages/shared-types/src/common.ts`, 6개 도메인 서비스, `apps/api/prisma/scripts/backfill-dialogue-normalized.ts`

## 맥락

FR-0-13은 이름 유일성을 **`(chatbotId, 정규화된 name)`** 기준으로 요구한다. 정규화는 FR-0-12가 정의한 `trim → 소문자 → 연속 공백 1칸 축약`이다. AC-6-2는 `"주문_배송조회"`가 있을 때 `" 주문_배송조회 "`를 `409`로 막을 것을 요구한다.

문제는 **이 규칙을 DB 제약으로 직접 표현할 수 없다**는 점이다.

- SQLite에는 정규식 치환 함수가 없어 "연속 공백 축약"을 SQL로 만들 수 없다.
- `LOWER()`는 **ASCII 전용**이다(유니코드 케이스 폴딩을 하지 않는다).
- Prisma는 SQLite에서 **함수 기반 인덱스(expression index)를 지원하지 않는다.**
- 따라서 `@@unique([chatbotId, name])`만 걸면 `"FAQ 안내"`와 `"faq  안내"`가 **둘 다 저장된다.**

요구사항은 두 안을 제시했다 — **A안**: `nameNormalized` 컬럼 + 유니크 인덱스 / **B안**: 서비스 계층 사전 검사만.

## 결정

**A안을 채택한다.**

1. 유일성을 요구하는 6개 모델에 정규화 컬럼을 둔다.
   | 모델 | 컬럼 | 유니크 |
   |---|---|---|
   | `Intent` / `Keyword` / `ContextVariable` / `DialogNode` | `nameNormalized String @default("")` | `@@unique([chatbotId, nameNormalized])` |
   | `HomonymDictionary` | `wordNormalized` | `@@unique([chatbotId, wordNormalized])` |
   | `FaqEntry` | `questionNormalized` | `@@unique([chatbotId, questionNormalized])` |
2. 정규화 구현은 **단 하나**다 — `packages/shared-types/src/common.ts`의 `normalizeText()`. `packages/dialogue-engine`이 re-export하고, API 서비스·매퍼·프런트가 모두 이것을 쓴다(FR-0-12).
   ```ts
   export function normalizeText(text: string): string {
     return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
   }
   ```
3. **값은 애플리케이션이 쓰기 시점에 채운다.** DB 트리거·생성 컬럼(generated column)은 사용하지 않는다.
4. 서비스 계층 사전 검사도 **유지**한다. 역할을 나눈다 — 사전 검사는 **UX**(어떤 이름과 충돌했는지 안내), 유니크 인덱스는 **최종 방어선**(경합). `P2002` 발생 시 전역 필터가 `409 DUPLICATE_NAME`(FAQ는 `DUPLICATE_FAQ`)으로 변환한다.
5. 표시용 원문(`name`/`question`)은 **trim만 적용해** 그대로 보존한다. 사용자가 입력한 대소문자가 화면에서 유지되어야 한다.
6. 기존 행 백필은 **애플리케이션 스크립트**로 수행하고, 유니크 인덱스는 백필 **이후** 마이그레이션에서 생성한다(3단계 절차, `dialogue-design-설계.md` §3.2).

## 근거

- **경합에서 안전하다.** B안(사전 검사만)은 "조회 → 없음 확인 → 삽입" 사이의 창이 열려 있어 동시 요청 2건이 같은 이름을 만들 수 있다. 이 시스템에는 아직 낙관적 잠금도 분산 락도 없다(EX-X-2 last-write-wins). 유일성은 **뒤늦게 발견되면 수습 비용이 큰 제약**이다 — 이미 중복된 의도를 참조하는 노드가 생긴 뒤에는 병합이 수작업이 된다.
- **정규화를 DB로 내릴 방법이 없다.** 위 맥락의 4가지 제약 때문에, "정규화된 비교"를 DB가 하려면 **정규화된 값을 컬럼으로 갖는 수밖에 없다.** 이것은 우회가 아니라 유일한 경로다.
- **부수 효과가 크다.** `nameNormalized`는 유일성뿐 아니라 (a) 이름 기반 조회(`q` 검색의 정확일치 구간), (b) 대량 업로드에서 "기존 의도와 같은 이름인가" 판정(FR-6-24 `MERGE`/`REPLACE`/`SKIP`), (c) 엔진의 사전 인덱싱 키를 **전부 인덱스 지원 하에** 처리하게 해 준다. B안이었다면 (b)는 챗봇 전체 의도를 메모리로 올려 비교해야 한다.
- **`NFKC` 정규화를 추가한 이유**: 전각 문자(`ＦＡＱ`)와 반각 문자(`FAQ`)는 `toLowerCase()`로 같아지지 않는다. 이 차이를 남겨 두면 유니크 제약을 **문자 폭만 바꿔 우회**할 수 있다. 기존 `matcher.ts`의 `normalize()`에는 없던 단계지만, 기존 단위 테스트 입력이 전부 NFKC 불변이라 하위호환이 깨지지 않는다.
- **ADR-0002의 역할 분담을 그대로 재사용한다** — "사전 검사는 UX, 제약은 방어선". 새 규약을 만들지 않고 기존 규약을 확장했다.

### 왜 `@default("")`인가

기존 행이 있는 상태에서 `NOT NULL` 컬럼을 추가하려면 DB 기본값이 필요하다. 빈 문자열로 추가한 뒤 스크립트가 백필하고, **그다음에** 유니크 인덱스를 만든다. 순서를 지키지 않으면 "빈 문자열이 여러 개"라 인덱스 생성이 실패한다. 백필 스크립트는 정규화 충돌을 발견하면 **중단하고 충돌 목록을 출력**해, 운영자가 수동 정리 후 재실행하게 한다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| **B안** 서비스 사전 검사만 | 경합 창이 열린다. 중복이 생긴 뒤의 수습 비용이 크고, 대량 업로드 병합 판정도 메모리 비교가 된다 |
| `@@unique([chatbotId, name])`(원문 기준) | AC-6-2(공백 차이 409)를 만족하지 못한다. 요구사항 미충족 |
| DB 생성 컬럼(generated/stored column) | SQLite는 `STORED` 생성 컬럼에 정규식 치환을 쓸 수 없고, Prisma의 SQLite 프로바이더가 이를 모델링하지 못한다. Postgres 전환 시에도 정규화 로직이 **앱과 DB 두 곳**에 생겨 FR-0-12(단일 소스)를 깬다 |
| 유니크 제약 없이 트랜잭션 격리 수준 상향 | SQLite에는 의미가 제한적이고, Postgres에서도 `SERIALIZABLE`은 전역 성능 비용이 크다. 제약 하나로 끝날 문제에 과도 |
| `citext`/`COLLATE NOCASE` 활용 | 대소문자만 해결하고 **공백 축약·NFKC는 해결하지 못한다.** 또한 DB 종속이라 이식성(개발명세서 §5)을 해친다 |

**감수하는 비용**: ① 모델당 컬럼 1개가 늘고, 쓰기 경로에서 `normalizeText()` 호출을 **빠뜨리면 빈 문자열끼리 충돌**해 두 번째 삽입이 실패한다 → 매퍼/서비스 진입점을 하나로 좁히고(§8.1) 통합 테스트로 고정한다. ② 정규화 규칙을 나중에 바꾸면 **전 행 재백필 + 충돌 정리**가 필요하다 → `normalizeText()` JSDoc에 "변경 시 전 도메인 유일성 의미가 바뀐다"를 경고로 남긴다.

## 결과

- `shared-types/src/common.ts`: `normalizeText()` 추가, `dialogue-engine`이 re-export.
- `schema.prisma`: 정규화 컬럼 6개 + 유니크 인덱스 6개.
- `prisma/scripts/backfill-dialogue-normalized.ts`: 멱등 백필 + 충돌 검출 중단.
- `all-exceptions.filter.ts`: `P2002`를 인덱스명으로 구분해 `DUPLICATE_NAME` / `DUPLICATE_FAQ` / `DUPLICATE_SLUG`로 매핑.
- 후속: 동의어(FR-6-16)·대체질문(FR-9-4의 `altQuestions` 부분)은 **JSON 안에 있어 이 방식으로 제약할 수 없다.** 서비스 사전 검사 + 단일 트랜잭션으로 처리하며(SQLite 단일 라이터 전제), Postgres 전환 시 별도 유니크 테이블 승격을 재검토한다(`dialogue-design-설계.md` §12).
