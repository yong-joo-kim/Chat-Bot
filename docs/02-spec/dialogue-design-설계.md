# 대화 설계(빌더) (No.5~9) — 세부 설계서

> **상위 문서**: `docs/02-spec/개발명세서.md` (§2 모노레포/계층규약, §3 데이터모델, §4 API, §5 비기능, §6 결정사항)
> **입력 문서**: `docs/requirements/dialogue-design.md` (요구사항 정의서, FR/AC/EX/DD 식별자 원본)
> **선행 설계서**: `docs/02-spec/chatbot-operations-설계.md` — 4계층 구조·오류 봉투·삭제 정책(`onDelete: Restrict` + 사전검사 409)·zod 단일 검증 규약을 **그대로 상속**한다.
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`
> **관련 ADR**: `decisions/ADR-0005` ~ `ADR-0008` (신규), `ADR-0002`/`ADR-0003`(상속)
> **작성**: system-architect · 2026-09-19 · **다음 단계**: `ui-designer` → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`

이 문서는 개발명세서를 **대체하지 않고 확장**한다. 명명 규칙(엔터티 PascalCase, 테이블 snake_case `@@map`, REST `/api/v1/`, zod 단일 소스, 4계층 모듈)은 이전 그룹과 동일하다.

---

## 1. 범위와 전제

| 항목 | 내용 |
|---|---|
| 대상 기능 | No.5 대화그래프 빌더 / No.6 의도·키워드 관리 / No.7 동음이의어 사전 / No.8 컨텍스트(슬롯필링) / No.9 FAQ 관리 + **매칭 엔진 실행기(FR-E)** |
| GPU 필요도 | 1~2 → **`apps/api` + `packages/dialogue-engine` 동기 처리**. `apps/ml-worker`/Job Queue/Redis 미도입 (개발명세서 §1 설계원칙, §6-4) |
| `packages/dialogue-engine` | **이 Phase에서 처음으로 본격 사용**한다. 매칭/세션전이/설계점검/유사후보 산출이 전부 이 패키지의 순수 함수다 |
| `packages/llm-provider` | 사용하지 않음. 의미 유사도(임베딩)는 No.18, 생성형 응답은 No.30 범위 |
| DB | SQLite (개발명세서 §6-4). 원시 SQL 신규 도입 **0건**(NFR-M6) |
| 신규 런타임 의존성 | `exceljs`(apps/api 서버 전용, ADR-0007) 1건. CSV 파서는 자체 구현(의존성 0) |
| 대화 실행 경로 | 엔진 코어(순수 함수)까지만. 대화 REST/WS API·채널 렌더링·세션 영속화는 No.10/No.11 |

**구현 순서 권고(요구사항 §4.1 승계)**: `shared-types` 스키마 → `dialogue-engine` 순수 함수 → `intents` → `keywords` → `homonyms` → `faqs` → `contexts` → `dialog-nodes` → 대량 업로드 → 설계 점검/흐름 요약.
의도/키워드가 다른 모든 리소스의 참조 대상이므로 먼저 완성해야 통합 테스트를 작성할 수 있다.

---

## 2. 설계 결정 요약

요구사항 §5.2가 제기한 **DD-1~DD-10**과, 설계 과정에서 추가로 확정한 **DD-11~DD-17**이다.

| ID | 이슈 | 결정 | 근거 |
|---|---|---|---|
| **DD-1** | `HomonymDictionary`/`ContextVariable`에 `updatedAt` 없음 | **채택** — 두 모델에 `updatedAt DateTime @default(now()) @updatedAt` 추가. `Intent`/`Keyword`/`ContextVariable`/`HomonymDictionary`에 `description String?` 추가 | §3.1, FR-0-14 정렬 규약을 만족할 수 없었음 |
| **DD-2** | `DialogNode` 필드 확장 + 캔버스 좌표 선반영 | **부분 채택** — `nodeType`/`matchMode`/`enabled`/`priority`/`description` 추가. **`canvasX`/`canvasY`는 보류(기각)** | §2.1 |
| **DD-3** | `FaqEntry` 확장 | **부분 채택** — `altQuestions`(JSON)/`enabled`/`questionNormalized` 추가. **`keywordIds`는 도입하지 않음(기각)** | §2.2 |
| **DD-4** | 정규화 유일성 구현 방식 | **A안 채택** — `nameNormalized`(FAQ는 `questionNormalized`, 동음이의어는 `wordNormalized`) 컬럼 + `@@unique([chatbotId, *Normalized])` | **ADR-0006** |
| **DD-5** | `DialogNode` 역참조 성능/정확도 | **조인 테이블 채택** — `DialogNodeIntent`/`DialogNodeKeyword` 신설, 기존 `intentIds`/`keywordIds` JSON 컬럼은 **완전 제거**(파생 캐시로도 남기지 않음) | **ADR-0005** |
| **DD-6** | `DialogNode.contextVariableId` FK 승격 | **채택** — `ContextVariable?` 관계 + `onDelete: Restrict, onUpdate: Cascade` | ADR-0005 §결과 |
| **DD-7** | `importToken` dry-run 결과 보관 | **①안(서버 메모리) 채택 + `ImportStagingStore` 인터페이스 추상화**. `ImportBatch` 테이블은 만들지 않는다 | **ADR-0007** §2 |
| **DD-8** | `.xlsx` 파서 의존성 | **xlsx 지원 유지, 파서는 `exceljs` 채택**. SheetJS `xlsx`(npm 0.18.5)는 **보안상 기각**. CSV 리더를 먼저 구현하고 동일 `SheetReader` 인터페이스로 xlsx를 뒤에 붙인다 | **ADR-0007** |
| **DD-9** | 인덱스 | **채택 + 확장** — 6개 테이블에 `(chatbotId, updatedAt)`·`(chatbotId, priority)`·`(chatbotId, category)`, 조인 테이블에 역방향 인덱스 | §3.1 |
| **DD-10** | 세션 영속화 | **테이블 만들지 않음**(요구사항 FR-8-15 확정). `ContextSessionState`는 stateless 계약으로만 존재 | §7.6 |
| **DD-11** | `normalizeText` 단일 소스 위치 | **`packages/shared-types/src/common.ts`에 구현**하고 `packages/dialogue-engine`이 re-export. FE/BE/엔진이 동일 구현을 공유 | §2.3 |
| **DD-12** | 아웃풋 12종 payload | `z.discriminatedUnion('type', ...)` 12분기. DB 저장 형식은 **기존과 동일한 `{ type, payload }` JSON 배열**(구조 변경 없음) | §4.3 |
| **DD-13** | 노드의 컨텍스트 인풋 조건 의미 | **"직전 턴에 해당 컨텍스트 폼이 `COMPLETED`된 경우"** 충족으로 정의. 폼 완료와 후속 아웃풋이 **같은 턴**에 이어진다 | §7.3 S1/S3 |
| **DD-14** | 명시적 엣지 테이블(`DialogNodeEdge`) | **도입하지 않음**. 이동은 `DIALOG_MOVE` 아웃풋 payload로만 표현하고, 그래프 탐색은 엔진이 outputs에서 파생 | §2.1과 동일 근거 |
| **DD-15** | 조인 테이블의 `onDelete` | 양쪽 모두 **`Restrict`**. 노드 삭제/수정 시 링크 행은 서비스 트랜잭션에서 **명시적으로 선삭제**한다(ADR-0002 "암묵 cascade 금지" 일관성) | ADR-0005 |
| **DD-16** | 오류 행 CSV 다운로드(FR-6-27) | **서버 엔드포인트 미도입**. 검증/커밋 응답에 이미 `errors[]`가 있으므로 **프런트가 클라이언트에서 CSV 생성**. 이스케이프 헬퍼는 `shared-types`에 공유 | §5.2 주석 |
| **DD-17** | 설계 점검·흐름 요약의 구현 위치 | `apps/api/src/**/lib`이 아니라 **`packages/dialogue-engine`**. 순환 탐색 로직을 런타임 실행기(hop limit)와 공유해야 규칙 불일치가 생기지 않는다 | §7.7 |

### 2.1 DD-2 — 캔버스 좌표(`canvasX`/`canvasY`)를 지금 넣지 않는 이유

요구사항 §4.5.1·§9.2는 "후속 캔버스 대비 nullable 좌표를 지금 추가할 것"을 권고했다. **기각한다.**

1. **이 저장소에 이미 같은 판단의 선례가 있다.** ADR-0004는 `ConversationLog.normalizedMessage` 컬럼을 "**쓰기 주체가 없다 — 지금 넣으면 값을 채울 수 없는 컬럼만 생긴다**"는 이유로 기각하고 후속 Phase 과제로 예약했다. `canvasX`/`canvasY`도 이번 Phase에 쓰기 주체(캔버스 UI)가 존재하지 않는다. 동일 상황에 다른 결론을 내면 규약이 흔들린다.
2. **"재작업 예방" 효과가 실제로는 거의 없다.** nullable 컬럼 2개 추가는 `ALTER TABLE ADD COLUMN` 2줄짜리 비파괴 마이그레이션이며, 나중에 넣어도 비용이 같다. 반대로 지금 넣으면 API 응답 스키마·mapper·CSV 내보내기·seed에 "항상 null인 필드"가 전파된다.
3. **캔버스의 진짜 선행 과제는 좌표가 아니라 엣지 모델이다**(요구사항 §4.5.1 근거 2). 좌표만 미리 넣으면 "캔버스 준비가 됐다"는 잘못된 신호를 주면서, 정작 비용이 큰 `DialogNodeEdge` 설계는 그대로 남는다. 둘은 **같은 마이그레이션에서 함께** 결정해야 한다(DD-14와 한 묶음).

> **후속 인계**: 캔버스 도입 Phase는 `canvasX`/`canvasY`/`DialogNodeEdge`를 한 번에 설계한다. 그때도 **폼 기반 편집 경로를 키보드 접근성 대체 수단으로 존치**해야 한다(UIUX §3).

### 2.2 DD-3 — `FaqEntry.keywordIds`를 도입하지 않는 이유 (⚠ PM 확인 항목)

요구사항 FR-9-1은 FAQ 입력에 `keywordIds`(선택)를 포함한다. 그러나:

- **어떤 FR/AC/EX도 이 필드의 런타임 동작을 정의하지 않는다.** 매칭 가중치인지, 목록 필터인지, 분류 태그인지 명세가 없다. `ui-designer`는 의미를 모르는 다중선택 폼을 그려야 하고, 엔진은 읽을 근거가 없다.
- **참조 간선이 하나 더 늘어난다.** 도입하면 키워드 삭제 사전검사(FR-6-18, EX-R-3)의 대상이 되어야 하는데, JSON 컬럼이면 DD-5가 지적한 "전체 스캔 + LIKE 오탐" 문제가 FAQ에서 재발한다. 정직하게 하려면 세 번째 조인 테이블(`FaqEntryKeyword`)이 필요하다 — **소비자가 없는 기능에 테이블 1개**는 과설계다.

**결정**: 이번 Phase에서 제외한다. 재도입이 필요해지면 `FaqEntryKeyword` 조인 테이블 + 마이그레이션 1건으로 충분하며(동작이 정의되는 시점 = FAQ 키워드 가중치 매칭을 하는 No.18 또는 위젯 자동완성 고도화 No.11), 그때 ADR-0005와 동일한 패턴을 재사용한다.
**PM 확인 필요**: 이 축소는 요구사항 FR-9-1의 입력 필드 1개를 줄인다.

### 2.3 DD-11 — `normalizeText`를 `shared-types`에 두는 이유

FR-0-12는 "정규화 규칙의 단일 소스를 `packages/dialogue-engine`에 두고 API 서버도 재사용"을 요구한다. 의존 방향을 보면 `dialogue-engine → shared-types`이며 `apps/web`은 `shared-types`만 참조한다. 구현을 `dialogue-engine`에 두면 **프런트가 중복 입력 사전 경고(FR-9-4, FR-6-5)를 위해 엔진 패키지 전체를 번들에 끌어와야 한다.**

따라서 **구현은 `shared-types/src/common.ts`(가장 낮은 공통 의존)에 두고, `dialogue-engine`이 `export { normalizeText } from '@chat-bot/shared-types'`로 re-export**한다. `paginated()`·`csvEnumArray()`가 이미 같은 파일에 있는 런타임 헬퍼이므로 파일 성격에도 어긋나지 않는다. FR-0-12의 의도("구현이 하나")는 그대로 충족되고, 엔진 사용자 입장의 import 경로도 유지된다.

```ts
// packages/shared-types/src/common.ts
/** 텍스트 비교·중복 판정·매칭의 유일한 정규화 규칙(FR-0-12). 변경 시 전 도메인 유일성 의미가 바뀐다. */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
```

> `NFKC` 추가는 기존 `matcher.ts`의 `normalize()`에 없던 항목이다. 전각/반각 한글·영문·숫자(예: `ＦＡＱ` vs `FAQ`)가 DB 유니크 제약을 우회하는 것을 막기 위해 필요하다. 기존 단위 테스트(`matcher.spec.ts`)의 입력은 전부 NFKC 불변이라 **하위호환이 깨지지 않는다.**

---

## 3. 데이터 모델 변경 (개발명세서 §3 확장)

### 3.1 Prisma 스키마 변경안 (`apps/api/prisma/schema.prisma`)

> backend-implementer는 아래를 그대로 반영한 뒤 §3.2의 **3단계 절차**로 마이그레이션한다. 이 문서는 DDL 방향만 명시하고 실행하지 않는다.

#### (1) `Intent` — 정규화 유일성 + 설명 + 조인 관계

```prisma
model Intent {
  id             String   @id @default(uuid())
  chatbotId      String
  chatbot        Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name           String
  /// normalizeText(name) 결과. (chatbotId, nameNormalized)가 유일성 판정 기준이다(ADR-0006).
  /// 애플리케이션이 쓰기 시점에 항상 채운다. DB 트리거/생성컬럼은 사용하지 않는다(SQLite/Postgres 이식성).
  nameNormalized String   @default("")
  description    String?
  /// JSON 직렬화된 string[] (예문, 최대 500개 / 각 1~200자 — FR-6-4, FR-6-6)
  examples       String   @default("[]")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  nodeLinks DialogNodeIntent[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, updatedAt])
  @@map("intents")
}
```

#### (2) `Keyword` — 동일 패턴

```prisma
model Keyword {
  id             String   @id @default(uuid())
  chatbotId      String
  chatbot        Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name           String
  nameNormalized String   @default("")
  description    String?
  /// JSON 직렬화된 string[] (동의어, 최대 200개 — FR-6-14)
  synonyms       String   @default("[]")
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  nodeLinks DialogNodeKeyword[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, updatedAt])
  @@map("keywords")
}
```

#### (3) `HomonymDictionary` — 정책 필드 + `updatedAt`(DD-1)

```prisma
model HomonymDictionary {
  id             String   @id @default(uuid())
  chatbotId      String
  chatbot        Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  word           String
  wordNormalized String   @default("")
  description    String?
  /// JSON 직렬화된 HomonymMeaning[] — { label, contextHints[], intentId?, description? } 2~10개(FR-7-1, FR-7-6)
  /// meanings[].intentId는 FK가 아니다. 유효성은 서비스 계층이 검사하고(FR-7-5),
  /// 의도 삭제 사전검사(EX-R-2)는 이 JSON을 스캔한다(챗봇당 사전 항목 수가 작아 허용 — §7.5).
  meanings       String
  /// ASK | DEFAULT_MEANING | IGNORE (FR-7-7). 값 제약의 단일 소스는 zod HomonymPolicy.
  policy         String   @default("ASK")
  /// policy=ASK일 때 사용할 되묻기 문구. null이면 엔진이 기본 문구를 생성한다.
  clarifyPrompt  String?
  /// policy=DEFAULT_MEANING일 때 사용할 meanings 배열 인덱스(0-base).
  defaultMeaningIndex Int?
  createdAt      DateTime @default(now())
  /// DD-1 — 기존 행 백필을 위해 @default(now())를 함께 둔다.
  updatedAt      DateTime @default(now()) @updatedAt

  @@unique([chatbotId, wordNormalized])
  @@index([chatbotId, updatedAt])
  @@map("homonym_dictionaries")
}
```

#### (4) `ContextVariable` — 폼 속성 + `updatedAt`(DD-1)

```prisma
model ContextVariable {
  id                    String   @id @default(uuid())
  chatbotId             String
  chatbot               Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name                  String
  nameNormalized        String   @default("")
  description           String?
  /// JSON 직렬화된 ContextSlot[] — 1~20개(FR-8-4).
  /// slots[].keywordId는 FK가 아니며 서비스 계층이 검증한다(FR-8-5). 키워드 삭제 사전검사가 이 JSON을 스캔한다.
  slots                 String
  /// 치환자 {슬롯명} 지원(FR-8-13)
  completionMessage     String?
  /// JSON 직렬화된 string[]. 기본값은 FR-8-1.
  cancelKeywords        String   @default("[\"취소\",\"그만\",\"처음으로\"]")
  sessionTimeoutMinutes Int      @default(30)
  createdAt             DateTime @default(now())
  updatedAt             DateTime @default(now()) @updatedAt

  dialogNodes DialogNode[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, updatedAt])
  @@map("context_variables")
}
```

#### (5) `DialogNode` — DD-2/DD-5/DD-6 (이번 그룹 최대 변경)

```prisma
model DialogNode {
  id                String   @id @default(uuid())
  chatbotId         String
  chatbot           Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  name              String
  nameNormalized    String   @default("")
  description       String?
  /// NORMAL | START | FALLBACK (FR-5-1). 챗봇당 START·FALLBACK 각 최대 1개는 서비스가 보장한다(FR-5-4).
  nodeType          String   @default("NORMAL")
  /// ANY | ALL (FR-5-2). 같은 종류 조건 내부는 항상 OR.
  matchMode         String   @default("ANY")
  enabled           Boolean  @default(true)
  /// 클수록 먼저 평가(FR-5-8)
  priority          Int      @default(100)

  /// DD-6 — 단순 String에서 FK로 승격. 컨텍스트 삭제를 DB가 막는다(EX-R-4 최종 방어선).
  contextVariableId String?
  contextVariable   ContextVariable? @relation(fields: [contextVariableId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  /// JSON 직렬화된 DialogOutput[] — { type, payload } 1~10개(FR-5-7).
  /// payload 안의 targetNodeId / contextVariableId 참조는 앱 레벨 검사 대상이다(§7.5).
  outputs           String   @default("[]")
  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  /// DD-5 — intentIds / keywordIds JSON 컬럼을 대체한다(제거됨).
  intentLinks  DialogNodeIntent[]
  keywordLinks DialogNodeKeyword[]

  @@unique([chatbotId, nameNormalized])
  @@index([chatbotId, priority])
  @@index([chatbotId, nodeType])
  @@map("dialog_nodes")
}

/// DD-5 / ADR-0005 — 노드↔의도 다대다. 순서는 의미가 없다(같은 종류 조건은 항상 OR, FR-5-2).
model DialogNodeIntent {
  nodeId   String
  node     DialogNode @relation(fields: [nodeId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  intentId String
  intent   Intent     @relation(fields: [intentId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@id([nodeId, intentId])
  /// 역참조(이 의도를 쓰는 노드) 전용 — FR-6-8 linkedNodeCount, FR-6-11 삭제 사전검사
  @@index([intentId])
  @@map("dialog_node_intents")
}

model DialogNodeKeyword {
  nodeId    String
  node      DialogNode @relation(fields: [nodeId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  keywordId String
  keyword   Keyword    @relation(fields: [keywordId], references: [id], onDelete: Restrict, onUpdate: Cascade)

  @@id([nodeId, keywordId])
  @@index([keywordId])
  @@map("dialog_node_keywords")
}
```

> **DD-15 주의**: `node` 쪽도 `Restrict`다. 따라서 **노드 삭제·수정 시 서비스가 링크 행을 먼저 지워야 한다**(§7.4). `onDelete: Cascade`를 쓰면 한 줄 줄어들지만 ADR-0002가 정한 "DB 암묵 cascade 0건" 규약이 깨지고, 이후 리뷰에서 "여기는 되는데 저기는 왜 안 되나"라는 예외가 늘어난다.

#### (6) `FaqEntry` — DD-3

```prisma
model FaqEntry {
  id                 String   @id @default(uuid())
  chatbotId          String
  chatbot            Chatbot  @relation(fields: [chatbotId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  /// FAQ | SMALL_TALK | SELF_SERVICE | ERROR_RESPONSE
  category           String
  question           String
  /// normalizeText(question). (chatbotId, questionNormalized) 유일(FR-9-4, DUPLICATE_FAQ).
  questionNormalized String   @default("")
  answer             String
  /// JSON 직렬화된 string[] — 대체 질문 최대 30개(FR-9-3). 매칭 시 question과 동등 취급.
  /// altQuestions 간 중복은 DB가 아닌 서비스 계층이 검사한다(§7.2).
  altQuestions       String   @default("[]")
  enabled            Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([chatbotId, questionNormalized])
  @@index([chatbotId, category])
  @@index([chatbotId, updatedAt])
  @@map("faq_entries")
}
```

#### (7) 변경 없음

`ChatbotGroup`, `Chatbot`(관계 배열에 변경 없음 — 기존 `intents`/`keywords`/`homonyms`/`dialogNodes`/`contextVariables`/`faqs` 그대로), `Channel`, `User`, `AuditLog`, `ConversationLog`, `UnansweredQuestion`.

### 3.2 마이그레이션 영향 분석 및 절차

**핵심 제약**: `nameNormalized` 계열은 `NOT NULL` + `UNIQUE`인데, **정규화 규칙(NFKC·연속공백 축약)을 SQLite SQL로 재현할 수 없다**(`LOWER()`는 ASCII 전용, 정규식 치환 없음). 따라서 "컬럼 추가 → 애플리케이션 백필 → 유니크 인덱스 생성"을 **3단계로 분리**한다.

| 단계 | 산출물 | 내용 |
|---|---|---|
| **① 마이그레이션 A** | `add_dialogue_design_fields` | 신규 컬럼 전부(`*Normalized` 포함, `@default("")`) + 신규 조인 테이블 2개 + 비유니크 인덱스. **유니크 인덱스는 제외** |
| **② 백필 스크립트** | `apps/api/prisma/scripts/backfill-dialogue-normalized.ts` | 전 행을 읽어 `normalizeText()`로 `*Normalized` 갱신. **DD-5 JSON→조인테이블 이관**도 같은 스크립트에서 수행. 멱등이며 재실행 가능. 정규화 충돌(같은 챗봇 내 중복)이 발견되면 **중단하고 충돌 목록을 출력**한다(관리자가 수동 정리 후 재실행) |
| **③ 마이그레이션 B** | `add_dialogue_normalized_unique` | `@@unique` 4종 + `DialogNode.contextVariableId` FK 승격 + `intentIds`/`keywordIds` 컬럼 DROP |

| 항목 | 내용 |
|---|---|
| **기존 데이터 호환성** | 현재 dev DB의 대화설계 데이터는 seed의 `Intent` 1건 + `FaqEntry` 4건뿐이고 `dialog_nodes`/`keywords`/`homonym_dictionaries`/`context_variables`는 **0건**이다. 따라서 ②의 이관·충돌 위험은 실질적으로 없다. 그럼에도 절차를 남기는 이유는 이미 데이터를 채운 개발자 로컬 DB를 깨지 않기 위함이다 |
| `updatedAt` 추가(DD-1) | `@default(now())`를 함께 지정했으므로 기존 행이 `NOT NULL` 제약에 걸리지 않는다. `@updatedAt`만 쓰면 Prisma가 기존 행을 채우지 못해 마이그레이션이 실패한다 |
| **SQLite 테이블 재생성** | ③에서 `dialog_nodes`는 **재생성된다**(FK 추가 + 컬럼 DROP). Prisma가 임시 테이블 복사 SQL을 생성하며 데이터는 보존된다. 생성된 SQL에 `PRAGMA foreign_keys=OFF` 블록이 보이는 것은 정상이다 |
| 되돌리기 | ③ → ② → ① 역순. ③의 컬럼 DROP만 비가역이므로, 불안하면 ③을 적용하기 전 `dev.db`를 복사해 둔다 |
| Postgres 전환 시 | 동일 DDL이 유효하다. 3단계 절차도 그대로 쓰며, 그때는 `CREATE UNIQUE INDEX CONCURRENTLY`를 검토한다 |
| 실행 절차 | `pnpm --filter @chat-bot/api exec prisma migrate dev --name add_dialogue_design_fields` → `pnpm --filter @chat-bot/api exec ts-node prisma/scripts/backfill-dialogue-normalized.ts` → `... --name add_dialogue_normalized_unique` → `prisma generate` → `prisma db seed` |
| 대안(로컬 초기화) | 개발 초기 단계이므로 `prisma migrate reset` 후 seed 재생성도 허용한다. 단 **커밋되는 마이그레이션 파일은 위 3단계 형태를 유지**해야 한다(타 개발자/CI 재현성) |

### 3.3 개발명세서 §3 엔터티 표 갱신

- `Entity`(Keyword) 행 → **`Keyword`** 로 명칭 통일(API 경로 `/keywords`와 일치).
- `DialogNode` 설명에 "인풋조건은 조인테이블 `DialogNodeIntent`/`DialogNodeKeyword` + `contextVariableId` FK, 아웃풋 12종은 JSON(ADR-0005)" 추가.
- 신규 행 2개 추가: `DialogNodeIntent`, `DialogNodeKeyword`(노드↔의도/키워드 다대다 조인).

---

## 4. `packages/shared-types` 스키마 배치

**파일 배치 원칙**(개발명세서 §6-9): 도메인 스키마는 도메인 파일에 append, 횡단 관심사만 `common.ts`. 이번에는 도메인 파일이 비대해지므로(예상 900행+) **관심사 단위로 도메인 파일을 2개 신설**한다. 의존 방향은 단방향이다: `common.ts ← dialogue.ts ← dialogue-engine.ts`, `common.ts ← bulk-import.ts`. 파생 스키마(`.pick()/.partial()`)는 **원본과 같은 파일**에 둔다(§6-9 유지).

| 파일 | 성격 |
|---|---|
| `common.ts`(수정) | `ApiErrorCode` 값 추가, `normalizeText()`(DD-11) 추가 |
| `dialogue.ts`(대폭 확장) | 의도/키워드/동음이의어/컨텍스트/노드/FAQ 도메인 + 요청·응답 DTO |
| `dialogue-engine.ts`(신규) | 엔진 입출력 계약 — 번들/해석결과/trace/세션상태/설계점검/흐름트리 |
| `bulk-import.ts`(신규) | 대량 업로드 2단계 계약 — 의도·키워드·FAQ 3개 도메인이 공유하는 횡단 관심사 |

`index.ts`에 `export * from './bulk-import'; export * from './dialogue-engine';`를 `./dialogue` **뒤에** 추가한다.

### 4.1 `common.ts` 변경

| 대상 | 변경 | 근거 |
|---|---|---|
| `normalizeText(text)` | 신규 런타임 헬퍼(§2.3) | FR-0-12 |
| `ApiErrorCode` | 아래 16개 값 추가 | §5.4 |

```
DUPLICATE_NAME, DUPLICATE_FAQ, SYNONYM_CONFLICT, INVALID_REFERENCE,
INTENT_IN_USE, KEYWORD_IN_USE, CONTEXT_IN_USE, NODE_IN_USE,
START_NODE_EXISTS, FALLBACK_NODE_EXISTS, OUTPUT_PAYLOAD_INVALID, LIMIT_EXCEEDED,
IMPORT_TOO_LARGE, IMPORT_FILE_INVALID, IMPORT_TOKEN_EXPIRED, IMPORT_ABORTED
```

### 4.2 `dialogue.ts` — 도메인 스키마

**(a) 의도 (FR-6-1~13)**

| 스키마 | 정의 요지 |
|---|---|
| `IntentExampleSchema` | `z.string().trim().min(1).max(200).refine(v => !/[\n\r\t]/.test(v))` — 빈 예문/제어문자 거부(FR-6-4) |
| `IntentSchema`(수정) | 기존 + `description: z.string().max(300).optional()`, `examples: z.array(IntentExampleSchema).max(500)` |
| `CreateIntentSchema` | `{ name: DialogueNameSchema, description?, examples?: []}` |
| `UpdateIntentSchema` | `CreateIntentSchema.partial()` + `description` `.nullable()`(D-10 값 지우기) |
| `IntentListItemSchema` | `{ id, name, description?, exampleCount, linkedNodeCount, updatedAt }`(FR-6-8) |
| `IntentDetailSchema` | `IntentSchema.extend({ linkedNodes: z.array(ResourceRefSchema) })`(FR-6-9) |
| `IntentExampleMutationSchema` | `{ add?: IntentExampleSchema[], remove?: string[] }`(FR-6-10) |
| `IntentMutationMetaSchema` | `{ deduplicatedCount: number, conflicts: ExampleConflictSchema[] }`(FR-6-5, FR-6-7) |
| `ExampleConflictSchema` | `{ example, intentId, intentName }` |
| `BulkDeleteSchema` | `{ ids: z.array(z.string().uuid()).min(1).max(100) }`(FR-6-13, FR-9-10) |

공통 보조:
- `DialogueNameSchema = z.string().trim().min(1).max(100).refine(v => !/[\n\r\t]/.test(v), '이름에 줄바꿈이나 탭을 넣을 수 없습니다.')` (FR-6-3)
- `ResourceRefSchema = z.object({ id: z.string().uuid(), name: z.string() })` — 409 `details`와 "바로가기" UI가 공유(FR-0-10)

**(b) 키워드 (FR-6-14~18)** — `KeywordSchema`(+`description`, `synonyms.max(200)`), `CreateKeywordSchema`, `UpdateKeywordSchema`, `KeywordListItemSchema{ synonymCount, linkedNodeCount }`.

**(c) 동음이의어 (FR-7-1~9)**

```
HomonymPolicy        = z.enum(['ASK','DEFAULT_MEANING','IGNORE'])
HomonymMeaningSchema = { label: 1~100, contextHints: string(1~50)[] max 30, intentId?: uuid, description?: max 300 }
HomonymDictionarySchema = {
  id, chatbotId, word: 1~50, description?, meanings: HomonymMeaning[] min 2 max 10,
  policy: HomonymPolicy default 'ASK', clarifyPrompt?: max 200, defaultMeaningIndex?: int>=0,
  createdAt, updatedAt
}
  .superRefine: ① 두 의미에 동일 contextHint 중복 → issue(FR-7-4)
               ② policy==='DEFAULT_MEANING' && defaultMeaningIndex가 범위 밖 → issue
```
> **기존 `HomonymMeaningSchema`(`{ meaning, contextHint? }`)는 파괴적으로 교체**된다. 현재 사용처는 없고(엔진·API 모두 미참조), DB `meanings` JSON도 0건이라 안전하다.

**(d) 컨텍스트 (FR-8-1~7)**

```
ContextSlotType   = z.enum(['TEXT','NUMBER','DATE','PHONE','EMAIL','CHOICE','KEYWORD'])
SlotValidationSchema = { min?: number, max?: number, maxLength?: int, pattern?: string(max 200), dateFormat?: enum(['YYYY-MM-DD','YYYY.MM.DD','YYYYMMDD']) }
ContextSlotSchema = {
  name: /^[A-Za-z0-9_]{1,50}$/,      // 치환자 {슬롯명}과 1:1
  label: 1~50, prompt: 1~200, type: ContextSlotType, required: boolean default true,
  choices?: string(1~50)[] 2~20, keywordId?: uuid, validation?: SlotValidationSchema,
  errorPrompt?: max 200, maxRetry: int 0~5 default 2, exampleValue?: max 100
}
  .superRefine: type==='CHOICE' ⇒ choices 필수 / type==='KEYWORD' ⇒ keywordId 필수
ContextVariableSchema = { ..., slots: ContextSlot[] 1~20(폼 내 name 유일), completionMessage?: max 500,
                          cancelKeywords: string[] max 10 default ['취소','그만','처음으로'],
                          sessionTimeoutMinutes: int 1~180 default 30, updatedAt }
```
> `ContextSlotSchema.label`이 신규 필수 필드가 되므로 기존 `{ name, prompt, exampleValue? }` 형태는 **파괴적 변경**이다. DB 행 0건이라 안전하며, 매퍼는 `label` 누락 시 `name`으로 폴백해 방어한다(NFR-M4).

**(e) 대화 노드 (FR-5-1~11)** — `DialogNodeType = z.enum(['NORMAL','START','FALLBACK'])`, `DialogMatchMode = z.enum(['ANY','ALL'])`.

```
DialogNodeSchema = {
  id, chatbotId, name, description?, nodeType, matchMode, enabled, priority: int -1000~1000 default 100,
  intentIds: uuid[], keywordIds: uuid[],      // ← API 경계 표현은 그대로 유지(조인테이블은 저장 구현 세부)
  contextVariableId?: uuid, outputs: DialogOutput[] max 10, createdAt, updatedAt
}
  .superRefine: nodeType==='NORMAL' && 조건 0개 ⇒ issue(FR-5-3)
                enabled===true && outputs 0개 ⇒ issue(FR-5-6, EX-D-3)
DialogNodeListItemSchema = DialogNodeSchema.extend({
  conditionSummary: { intents: ResourceRef[], keywords: ResourceRef[], context?: ResourceRef },
  outputTypes: DialogOutputType[], incomingCount: int      // FR-5-11
})
CopyDialogNodeSchema = { name?: DialogueNameSchema }
```
> **중요**: DD-5(조인 테이블)는 **저장 계층의 변경일 뿐 API 계약을 바꾸지 않는다.** `intentIds`/`keywordIds`는 요청·응답 모두에서 배열로 유지되며, mapper가 링크 행 ↔ 배열을 변환한다. 프런트·shared-types 관점의 파괴적 변경은 없다.

**(f) 아웃풋 12종 판별 유니온 (FR-5-13, FR-5-14)** — §4.3 참조.

**(g) FAQ (FR-9-1~12)**

```
FaqEntrySchema = { id, chatbotId, category: FaqCategory, question: 1~300, answer: 1~2000,
                   altQuestions: string(1~300)[] max 30, enabled: boolean default true, createdAt, updatedAt }
CreateFaqSchema / UpdateFaqSchema(부분수정)
FaqListQuerySchema = PaginationQuery + { category?: csvEnumArray(FaqCategory), q?, enabled?, sort, order }
FaqListResponseSchema = paginated(FaqEntrySchema).extend({
  counts: z.record(FaqCategory, z.number().int())      // FR-9-2 카테고리별 요약
})
FaqSuggestQuerySchema = { q: z.string().min(1).max(300), mode: z.enum(['admin','public']).default('admin'), limit: 1~5 default 5 }
FaqSuggestionSchema   = { id, question, category, score: 0~1, matchedBy: z.enum(['PREFIX','CONTAINS','TOKEN']) }
FaqPublicSuggestionSchema = { id, question }     // mode=public — answer 미포함(AC-9-8)
```

### 4.3 아웃풋 12종 payload 규격 (DD-12)

`DialogOutputSchema = z.discriminatedUnion('type', [...12])`. 저장 형식은 기존과 동일한 `{ type, payload }`다.

| # | type | payload 스키마 | 이번 Phase |
|---|---|---|---|
| ① | `TEXT` | `{ text: 1~1000자 }` | 정의·실행 |
| ② | `CARD` | `{ title: 1~100, description?: max 500, imageUrl?: SafeUrl, altText?: 1~200, buttons?: ButtonItem[] max 5 }`<br>`.superRefine`: `imageUrl` 있으면 `altText` 필수(NFR-A7) | 정의·실행 |
| ③ | `IMAGE` | `{ imageUrl: SafeUrl, altText: 1~200(필수) }` | 정의·실행 |
| ④ | `BUTTON` | `{ text?: max 500, buttons: ButtonItem[] 1~5 }` | 정의·실행 |
| ⑤ | `LINK` | `{ label: 1~40, url: SafeUrl, openInNewTab: boolean default true }` | 정의·실행 |
| ⑥ | `PAUSE` | `{ durationMs: int 100~5000 }` | 정의·실행 |
| ⑦ | `PHONE_CALL` | `{ label: 1~40, phoneNumber: /^[0-9+\-() ]{5,20}$/ }` — 렌더링 시 `tel:` 생성 | 정의·실행 |
| ⑧ | `CONTEXT_FORM` | `{ contextVariableId: uuid }` | 정의·실행(세션 시작) |
| ⑨ | `DIALOG_MOVE` | `{ targetNodeId: uuid }` | 정의·실행(hop limit 10) |
| ⑩ | `SCENARIO` | `{ scenarioKey: 1~100, params?: Record<string, string>(최대 20키) }` | **정의·저장·검증만** |
| ⑪ | `SURVEY` | `{ surveyId: 1~100 }` **[No.27 이후 = v1(이전 형식·읽기 전용) — 새 저장은 v2 `{ version: 2, surveyId: uuid, onCompleteNodeId? }`]** | **정의·저장·검증만** **[No.27: v2는 대화 내 멀티턴 실행 — `survey-management-설계.md` §4.1·§5]** |
| ⑫ | `API_CONDITION` | `{ method: GET\|POST\|PUT\|PATCH\|DELETE, url: SafeUrl, headers?: Record<string,string>(최대 20키), bodyTemplate?: max 4000, conditions: ApiCondition[] 1~10 }` | **정의·저장·검증만** |

```
ButtonItemSchema = { label: 1~40, action: z.enum(['MESSAGE','LINK','NODE']), value: string }
  .superRefine: action==='LINK'    ⇒ value는 SafeUrlSchema 통과
                action==='NODE'    ⇒ value는 uuid (노드 참조 — 흐름 미리보기 대상, 순환검사 제외)
                action==='MESSAGE' ⇒ value 1~200자
ApiConditionSchema = { path: 1~200, operator: z.enum(['EQ','NEQ','GT','GTE','LT','LTE','CONTAINS','EXISTS']),
                       value?: max 500, nextNodeId: uuid }
```

- `UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY','API_CONDITION'] as const` 상수를 `dialogue.ts`에 두고 **엔진·API·UI 배지(FR-5-15)가 공유**한다. No.26/27 구현 시 이 상수에서 빼는 것만으로 실행이 열린다. **[정정 No.26·No.27 — 성립하지 않았다: 실행 가능 판정은 타입이 아니라 형태(`isUnsupportedOutput()`)로 하며, 상수는 `['SCENARIO']`로 줄었다. 설계 점검도 공용 함수 기반으로 교체됐다(ADR-0008 갱신 각주 2건)]**
- `API_CONDITION.url`은 `SafeUrlSchema`로 형식만 검증한다. **SSRF 방어(사설 IP 대역 차단)는 실행 Phase(No.26)의 책임**임을 스키마 JSDoc과 §12에 명시한다(NFR-S4).
- `API_CONDITION.headers`는 평문 저장이다. UI는 값에 `*` 마스킹을 적용하고, 암호화 저장은 No.26/No.45 과제로 기록한다(NFR-S5).

### 4.4 `dialogue-engine.ts` — 엔진 계약 (FR-E-1, FR-E-2, FR-8-8)

```
ContextSessionStatus = z.enum(['IN_PROGRESS','COMPLETED','CANCELLED','EXPIRED'])
ContextSessionStateSchema = {
  contextVariableId: uuid, currentSlotIndex: int>=0,
  /** ⚠ PII 가능(전화번호·이메일). 서버 로그에 원문 금지(NFR-S9, FR-8-16) */
  filledValues: z.record(z.string()),
  retryCount: int>=0, startedAt: date, lastInteractedAt: date, status: ContextSessionStatus
}

DialogueBundleSchema = { intents[], keywords[], homonyms[], dialogNodes[], contexts[], faqs[] }

TraceStageEnum = z.enum(['PREPROCESS','SESSION','HOMONYM','NODE','FAQ','INTENT','FALLBACK','OUTPUT'])
TraceCodeEnum  = z.enum([
  'EMPTY_INPUT','INPUT_TRUNCATED',
  'SESSION_ADVANCED','SESSION_RETRY','SESSION_CANCELLED','SESSION_EXPIRED','SESSION_COMPLETED','SESSION_DEFINITION_CHANGED',
  'HOMONYM_RESOLVED','HOMONYM_AMBIGUOUS','HOMONYM_IGNORED',
  'NODE_MATCHED','NODE_SKIPPED_DISABLED','NODE_CONDITION_FAILED','NODE_TIEBREAK',
  'FAQ_MATCHED','FAQ_DEFERRED','INTENT_MATCHED','INTENT_ONLY',
  'FALLBACK_NODE','FALLBACK_FAQ','FALLBACK_DEFAULT',
  'HOP_LIMIT_EXCEEDED','BROKEN_REFERENCE','UNSUPPORTED_OUTPUT','PAYLOAD_INVALID','EMPTY_OUTPUT'
])
TraceStepSchema = { stage: TraceStageEnum, code: TraceCodeEnum, targetId?: string, targetName?: string,
                    score?: number, message?: string }

HomonymResolutionSchema = { word, status: z.enum(['RESOLVED','AMBIGUOUS','IGNORED']),
                            meaningLabel?, intentId?, matchedHints: string[] }

DialogueResolutionSchema = {
  input: string, normalizedInput: string,
  matchedNodeId?: uuid, matchedIntentId?: uuid, matchedFaqId?: uuid,
  homonymResolution?: HomonymResolutionSchema,
  outputs: DialogOutput[],
  nextSession: ContextSessionStateSchema.nullable(),
  unsupportedOutputs: DialogOutputType[],
  trace: TraceStep[]
}

// 설계 점검(FR-5-16~18)
DesignIssueSeverity = z.enum(['ERROR','WARNING','INFO'])
DesignIssueCode = z.enum(['EMPTY_OUTPUT','BROKEN_REFERENCE','MOVE_CYCLE','DUPLICATE_CONDITION',
                          'ORPHAN_NODE','NO_FALLBACK_NODE','EMPTY_EXAMPLE_INTENT','UNSUPPORTED_OUTPUT'])
DesignIssueSchema = { code: DesignIssueCode, severity: DesignIssueSeverity,
                      resourceType: z.enum(['NODE','INTENT','KEYWORD','CONTEXT','FAQ','CHATBOT']),
                      resourceId?: string, resourceName?: string, path?: string[], message: string }
DesignValidationReportSchema = { issues: DesignIssue[], summary: { error: int, warning: int, info: int },
                                 checkedAt: date }

// 흐름 요약(FR-5-19)
FlowNodeSchema: z.lazy(() => ({ nodeId, name, nodeType, via: z.enum(['ROOT','DIALOG_MOVE','BUTTON_NODE']),
                                repeated: boolean, children: FlowNode[] }))
FlowTreeSchema = { roots: FlowNode[], orphanNodes: ResourceRef[] }
```

### 4.5 `bulk-import.ts` — 대량 업로드 2단계 계약 (FR-6-19~30, FR-9-9)

```
ImportResourceType = z.enum(['INTENT','KEYWORD','FAQ'])
ImportMergePolicy  = z.enum(['MERGE','REPLACE','SKIP'])            // default MERGE (FR-6-24)
ImportErrorPolicy  = z.enum(['SKIP_INVALID','ABORT_ON_ERROR'])     // default SKIP_INVALID (FR-6-25)
ImportRowErrorCode = z.enum(['EMPTY_NAME','EMPTY_VALUE','TOO_LONG','INVALID_CHAR',
                             'DUPLICATE_IN_FILE','SYNONYM_CONFLICT','INVALID_CATEGORY'])
ImportRowErrorSchema = { row: int>=1, column: string, value: string(max 200), code: ImportRowErrorCode, message: string }
ImportConflictSchema = { value: string, ownerId: uuid, ownerName: string }
ImportValidateResultSchema = {
  importToken: string, expiresAt: date, resourceType: ImportResourceType,
  totalRows, newItems, updatedItems, newValues, duplicatedRows,
  errors: ImportRowError[], conflicts: ImportConflict[]
}
ImportCommitRequestSchema = { importToken: string, mergePolicy: ImportMergePolicy default 'MERGE',
                              errorPolicy: ImportErrorPolicy default 'SKIP_INVALID' }
ImportCommitResultSchema  = { createdItems, updatedItems, createdValues, skippedRows,
                              errors: ImportRowError[] }
IMPORT_LIMITS = { maxFileBytes: 5 * 1024 * 1024, maxRows: 5000, tokenTtlMs: 10 * 60_000 }
escapeCsvCell(value: string): string   // 수식 인젝션 방어 런타임 헬퍼(FR-6-29, NFR-S7) — 서버 export와 프런트 오류 CSV가 공유
```

템플릿 헤더(FR-6-19) — **한국어 헤더 + 영문 별칭 둘 다 허용**(EX-I-1 오탐 감소):

| 리소스 | 열 |
|---|---|
| 의도 | `의도명`(intentName), `예문`(example), `설명`(description, 선택) |
| 키워드 | `키워드명`(keywordName), `동의어`(synonym), `설명`(description, 선택) |
| FAQ | `분류`(category), `질문`(question), `답변`(answer), `대체질문`(altQuestion, 선택) |

---

## 5. API 설계 (개발명세서 §4 확장)

### 5.1 공통 규약

| 항목 | 규칙 |
|---|---|
| 베이스 경로 | **`/api/v1/chatbots/:chatbotId/...`** 중첩(FR-0-9). 컨트롤러는 `@Controller('chatbots/:chatbotId/intents')` 형태 |
| 챗봇 스코프 | 모든 핸들러가 `ChatbotScopeService.assertReadable/assertWritable(chatbotId)`를 **서비스 진입 첫 줄**에서 호출. 미존재 → `404`, `ARCHIVED` + 쓰기 → `409 CHATBOT_ARCHIVED`(FR-0-11) |
| 교차 챗봇 참조 | 다른 챗봇의 리소스 ID → **`403`이 아니라 `404`**(NFR-S10, AC-C-3). 모든 조회 `where`에 `chatbotId`를 **항상** 포함한다 |
| 검증 | `ZodValidationPipe`(body) / `ZodQueryPipe`(query), strip 모드 (ADR-0003) |
| 목록 | `{ items, total, page, pageSize }` + `q`/`sort`/`order`(기본 `updatedAt desc`, FR-0-14) |
| 오류 | `{ statusCode, code, message, details? }`. 참조 충돌 409는 `details`에 **상위 5건의 `{field:'nodes[0]', message:'노드명'}`**을 담아 UI 바로가기를 제공(FR-0-10) |
| 권한 | 조회 `@RequirePermission('dialogue:read')` / 변경 `@RequirePermission('dialogue:write')`. 가드는 No.12까지 no-op(NFR-S8) |
| 업로드 | `@UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5MB, files: 1 } }))` — 디스크 미기록(NFR-S6) |

### 5.2 엔드포인트 명세 (총 50)

> 모든 경로 앞에 `/api/v1/chatbots/:chatbotId`가 생략되어 있다.
> **라우트 선언 순서**: 정적 세그먼트(`import/template`, `export`, `bulk-delete`, `suggest`, `validate`, `flow`, `test`)를 반드시 `:id` **앞에** 선언한다(ADR-0003 §라우트 주의와 동일).

#### 의도 (`intents`) — 11

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 1 | `POST /intents` | `CreateIntentSchema` | `201` `IntentDetailSchema` + `meta: IntentMutationMeta` | 400 / 404 / 409 `DUPLICATE_NAME` |
| 2 | `GET /intents` | `PaginationQuery + q/sort/order` | `paginated(IntentListItemSchema)` | 400 / 404 |
| 3 | `GET /intents/:id` | — | `IntentDetailSchema` | 404 |
| 4 | `PATCH /intents/:id` | `UpdateIntentSchema` | `IntentDetailSchema` + `meta` | 400 / 404 / 409 |
| 5 | `DELETE /intents/:id` | — | `204` | 404 / **409 `INTENT_IN_USE`** |
| 6 | `PATCH /intents/:id/examples` | `IntentExampleMutationSchema` | `IntentDetailSchema` + `meta` | 400 `LIMIT_EXCEEDED` / 404 |
| 7 | `POST /intents/bulk-delete` | `BulkDeleteSchema` | `204` | 404 / 409 `INTENT_IN_USE`(전체 롤백, FR-6-13) |
| 8 | `POST /intents/import/validate` | `multipart/form-data` `file` | `ImportValidateResultSchema` | 400 `IMPORT_TOO_LARGE`\|`IMPORT_FILE_INVALID` |
| 9 | `POST /intents/import/commit` | `ImportCommitRequestSchema` | `ImportCommitResultSchema` | 400 `IMPORT_TOKEN_EXPIRED`\|`IMPORT_ABORTED` / 409 |
| 10 | `GET /intents/import/template?format=csv\|xlsx` | — | `200` 파일(`text/csv` / `application/vnd.openxmlformats-...`) | 400 |
| 11 | `GET /intents/export?format=csv` | — | `200` `text/csv`(BOM 포함, 수식 이스케이프) | 404 |

#### 키워드 (`keywords`) — 9

`POST /keywords` · `GET /keywords` · `GET /keywords/:id` · `PATCH /keywords/:id` · `DELETE /keywords/:id`(409 `KEYWORD_IN_USE`) · `POST /keywords/import/validate` · `POST /keywords/import/commit` · `GET /keywords/import/template` · `GET /keywords/export`.
생성·수정 시 동의어 교차 충돌은 **`409 SYNONYM_CONFLICT`**(FR-6-16, AC-6-9)이며 메시지에 충돌 키워드명을 포함한다.

#### 동음이의어 (`homonyms`) — 6

`POST` · `GET` · `GET /:id` · `PATCH /:id` · `DELETE /:id`(항상 `204`, FR-7-9) · **`POST /homonyms/test`**.

```
POST /homonyms/test   요청 { text: z.string().min(1).max(1000) }
                      응답 { resolution: HomonymResolutionSchema | null, outputs: DialogOutput[], trace: TraceStep[] }
```
서버는 `resolveHomonym()`(엔진 동일 함수)만 호출한다 — 노드/FAQ 매칭은 수행하지 않는다(FR-7-11의 "동음이의어 판정 결과만").

#### 컨텍스트 (`contexts`) — 5

`POST` · `GET` · `GET /:id` · `PATCH /:id` · `DELETE /:id`(409 `CONTEXT_IN_USE`, FR-8-6).
슬롯 미리보기(FR-8-7)는 **클라이언트 렌더링**이며 서버 엔드포인트를 두지 않는다.

#### 대화 노드 (`dialog-nodes`) — 8

| # | 메서드 · 경로 | 요청 | 응답 | 오류 |
|---|---|---|---|---|
| 1 | `POST /dialog-nodes` | `CreateDialogNodeSchema` | `201` `DialogNodeSchema` | 400 `OUTPUT_PAYLOAD_INVALID` / 404 `INVALID_REFERENCE` / 409 `DUPLICATE_NAME`·`START_NODE_EXISTS`·`FALLBACK_NODE_EXISTS` |
| 2 | `GET /dialog-nodes` | 목록 쿼리 + `nodeType?`(콤마 구분 다중값, `csvEnumArray` — 예: `?nodeType=NORMAL,START`, `ChatbotListQuerySchema.status`와 동일 패턴)·`enabled?` | `paginated(DialogNodeListItemSchema)` | 400 / 404 |
| 3 | `GET /dialog-nodes/flow` | — | `FlowTreeSchema` | 404 |
| 4 | `POST /dialog-nodes/validate` | — (본문 없음, 서버가 번들 전체 점검) | `DesignValidationReportSchema` | 404 |
| 5 | `GET /dialog-nodes/:id` | — | `DialogNodeSchema` | 404 |
| 6 | `PATCH /dialog-nodes/:id` | `UpdateDialogNodeSchema` | `DialogNodeSchema` | 위와 동일 |
| 7 | `POST /dialog-nodes/:id/copy` | `CopyDialogNodeSchema` | `201` `DialogNodeSchema`(`enabled=false`) | 404 / 409 |
| 8 | `DELETE /dialog-nodes/:id` | — | `204` | 404 / 409 `NODE_IN_USE` |

> `POST /dialog-nodes/validate`는 **조회성이지만 POST**다. GET으로 두면 브라우저/프록시 캐시가 오래된 점검 결과를 보여줄 수 있고, 향후 "편집 중 초안 노드를 본문으로 함께 보내 점검"(No.10 확장)으로 자연스럽게 확장된다. 파괴적 동작이 아니므로 개발명세서 §4.1의 "파괴적 동작 GET 금지" 규칙과 충돌하지 않는다.

#### FAQ (`faqs`) — 11

`POST` · `GET`(+`counts`) · `GET /faqs/suggest` · `POST /faqs/bulk-delete` · `POST /faqs/import/validate` · `POST /faqs/import/commit` · `GET /faqs/import/template` · `GET /faqs/export` · `GET /faqs/:id` · `PATCH /faqs/:id` · `DELETE /faqs/:id`(항상 `204`).

`GET /faqs/suggest?q=&mode=admin|public&limit=` — `mode=public`은 `enabled=true`만, `{id, question}`만 반환(FR-9-6, AC-9-8). **`mode=public`도 이번 Phase에는 관리자 인증 경계 안에 있다**(위젯 공개 경로 노출은 No.11).

> **DD-16**: 오류 행 CSV 다운로드(FR-6-27)는 서버 엔드포인트를 만들지 않는다. `errors[]`가 이미 검증/커밋 응답에 있으므로 프런트가 `escapeCsvCell()`로 Blob을 만들어 내려준다. 토큰 수명과 무관하게 동작하며 서버 상태가 늘지 않는다.

### 5.3 개발명세서 §4 표 갱신 (오류 정정 포함)

§4의 "대화 설계" 행을 다음으로 교체한다. **`/entities` → `/keywords` 정정**(Prisma 모델·모듈명 일치)과 **`/chatbots/:chatbotId/` 중첩 통일**이 핵심이다.

```
| 대화 설계 | `/chatbots/:chatbotId/`{`intents`(+`/:id/examples`,`/bulk-delete`,`/import/validate|commit|template`,`/export`), `keywords`(+동일 import 계열), `homonyms`(+`/test`), `contexts`, `dialog-nodes`(+`/:id/copy`,`/validate`,`/flow`), `faqs`(+`/suggest`,`/bulk-delete`,import 계열)} | 5~9 |
```

### 5.4 `ApiErrorCode` 추가 코드표

| code | HTTP | 발생 지점 | 사용자 메시지(기본) |
|---|---|---|---|
| `DUPLICATE_NAME` | 409 | 의도/키워드/컨텍스트/노드/동음이의어 생성·수정 | "이미 같은 이름이 있습니다. 다른 이름을 입력해 주세요." |
| `DUPLICATE_FAQ` | 409 | FAQ 생성·수정 | "이미 같은 질문이 등록되어 있습니다." |
| `SYNONYM_CONFLICT` | 409 | 키워드 생성·수정·업로드 | "동의어 '{값}'은(는) 키워드 '{이름}'에서 이미 사용 중입니다." |
| `INTENT_IN_USE` | 409 | 의도 삭제 | "이 의도를 사용하는 대화 노드가 {n}건 있습니다. 먼저 조건을 정리해 주세요." |
| `KEYWORD_IN_USE` | 409 | 키워드 삭제 | "이 키워드를 사용하는 대화 노드/컨텍스트 슬롯이 {n}건 있습니다." |
| `CONTEXT_IN_USE` | 409 | 컨텍스트 삭제 | "이 컨텍스트를 사용하는 대화 노드가 {n}건 있습니다." |
| `NODE_IN_USE` | 409 | 노드 삭제 | "이 노드로 이동하도록 설정된 노드가 {n}건 있습니다." |
| `START_NODE_EXISTS` | 409 | 노드 생성·수정 | "시작 노드는 챗봇당 1개만 지정할 수 있습니다(현재: {이름})." |
| `FALLBACK_NODE_EXISTS` | 409 | 노드 생성·수정 | "폴백 노드는 챗봇당 1개만 지정할 수 있습니다(현재: {이름})." |
| `INVALID_REFERENCE` | 404 | 노드/동음이의어/슬롯의 참조 ID | "선택한 {의도/키워드/컨텍스트/노드}를 찾을 수 없습니다." + `details`에 문제 ID |
| `OUTPUT_PAYLOAD_INVALID` | 400 | 아웃풋 payload 검증 | "{n}번째 아웃풋의 입력값을 확인해 주세요." + `details[].field = 'outputs[1].altText'` |
| `LIMIT_EXCEEDED` | 400 | 예문 500 / 슬롯 20 / 아웃풋 10 / 동의어 200 초과 | "최대 {max}개까지 등록할 수 있습니다(현재 {current}개)." |
| `IMPORT_TOO_LARGE` | 400 | 업로드 | "파일은 최대 5MB, 5,000행까지 올릴 수 있습니다." |
| `IMPORT_FILE_INVALID` | 400 | 업로드(헤더/인코딩/빈 파일) | "양식이 올바르지 않습니다. 템플릿을 내려받아 다시 시도해 주세요." |
| `IMPORT_TOKEN_EXPIRED` | 400 | 커밋 | "검증 결과가 만료되었습니다(10분). 파일을 다시 검증해 주세요." |
| `IMPORT_ABORTED` | 400 | 커밋(`ABORT_ON_ERROR`) | "오류 {n}건이 있어 전체를 취소했습니다. 한 건도 반영되지 않았습니다." |

전역 필터 매핑 확장: **Prisma `P2002` → 409**(대상 유니크 인덱스명으로 `DUPLICATE_NAME`/`DUPLICATE_FAQ` 구분), **`P2003` → 409**(`*_IN_USE` — 경합으로 사전검사를 통과한 경우, EX-R-7).

---

## 6. NestJS 모듈 구조 (개발명세서 §2.1·§2.2 확장)

```
apps/api/src/
├── app.module.ts                          # (수정) 6개 도메인 모듈 + DialogueCommonModule 등록
├── chatbots/
│   ├── chatbots.module.ts                 # (수정) exports에 ChatbotScopeService 추가
│   └── chatbot-scope.service.ts           # (신규) assertReadable/assertWritable — 404 / 409 CHATBOT_ARCHIVED
├── dialogue-common/                       # ── 6개 모듈이 공유하는 횡단 코드 ──
│   ├── dialogue-common.module.ts
│   ├── dialogue-bundle.service.ts         # 챗봇 1건의 대화 자산 → DialogueBundle 조립(엔진 입력)
│   ├── reference-check.service.ts         # 참조 사전검사 단일 진입점(409 + ResourceRef 상위 5건)
│   ├── import/
│   │   ├── sheet-reader.ts                # interface SheetReader { read(buf): Promise<SheetRow[]> }
│   │   ├── csv-sheet-reader.ts            # 자체 구현(의존성 0) — BOM/따옴표/CRLF 처리
│   │   ├── xlsx-sheet-reader.ts           # exceljs 스트리밍(ADR-0007)
│   │   ├── import-staging.store.ts        # interface + InMemoryImportStagingStore(TTL 10분, LRU)
│   │   └── lib/                           # ── 순수 함수 ──
│   │       ├── sheet-detect.ts            # 확장자/MIME/헤더 판별, 인코딩 이상 감지(EX-I-2)
│   │       ├── import-row-parser.ts       # 행 → {name,value} 정규화 + 행 오류 코드 판정(FR-6-23)
│   │       ├── import-planner.ts          # 파싱 결과 + 기존 데이터 → 검증 리포트/커밋 계획
│   │       └── csv-writer.ts              # 템플릿/내보내기 생성 + escapeCsvCell 적용
├── intents/
│   ├── intents.module.ts / intents.controller.ts / intents.service.ts / intent.mapper.ts
│   └── lib/
│       ├── example-set.ts                 # 정규화 dedupe(FR-6-5), 개수 제한, add/remove 병합
│       └── example-conflict.ts            # 타 의도 예문 교차 충돌 산출(FR-6-7)
├── keywords/  (+ lib/synonym-set.ts — dedupe·교차 충돌 판정)
├── homonyms/  (+ lib/meaning-validation.ts — 힌트 중복·기본의미 인덱스 검사)
├── contexts/  (+ lib/slot-definition.ts — 슬롯명 유일성·타입별 필수값·순서 이동)
├── dialog-nodes/
│   ├── dialog-nodes.module.ts / controller / service / dialog-node.mapper.ts
│   └── lib/
│       ├── node-links.ts                  # 링크 행 diff(추가/삭제) 계산 — DD-15 트랜잭션 입력
│       └── node-condition-summary.ts      # 목록 조건 칩·아웃풋 타입 요약 파생
└── faqs/      (+ lib/alt-question-set.ts — question+altQuestions 정규화 집합·중복 판정)
```

**계층 책임 경계(개발명세서 §2.1 그대로)**

- `controller`: 경로/파이프/가드/HTTP 상태코드만. Prisma 타입 미노출.
- `service`: Prisma 직접 의존, 비즈니스 규칙 단일 진입점(향후 `AuditLog` 지점). **`ChatbotScopeService` 호출이 첫 줄.**
- `mapper`: Prisma row ↔ zod DTO. **JSON 문자열 ↔ 객체 변환은 전부 여기서만**(NFR-M3). 조인 테이블 링크 ↔ `intentIds[]` 변환도 mapper 책임.
- `lib/*`: DB·Nest 무의존 순수 함수. 단위 테스트 1차 타깃.
- **매칭·정규화·세션전이·설계점검·유사후보는 `lib/`이 아니라 `packages/dialogue-engine`**(DD-17, §7).

**개발명세서 §2.2 표 갱신**: "대화 설계 (No.5~9)" 행의 모듈 목록에 `dialogue-common`을 추가하고 상태를 "설계 완료 → `dialogue-design-설계.md` §6"으로 바꾼다.

---

## 7. `packages/dialogue-engine` 설계 (FR-E)

### 7.1 파일 구조

```
packages/dialogue-engine/src/
├── index.ts                 # (수정) 공개 API 재수출
├── normalize.ts             # (신규) normalizeText re-export + tokenize/jaccard/containsWord
├── matcher.ts               # (수정) matchIntent / matchFaq / simulate — 하위호환 유지 + resolveResponse 위임
├── resolver.ts              # (신규) ★ resolveResponse — 6단계 오케스트레이션
├── node-matcher.ts          # (신규) evaluateNode / rankNodes(FR-5-8 타이브레이크)
├── homonym.ts               # (신규) resolveHomonym / buildClarifyOutput
├── context-session.ts       # (신규) startContextSession / advanceContextSession / validateSlotValue
├── faq.ts                   # (신규) matchFaqEntry(altQuestions·enabled) / suggestSimilarFaqs(FR-9-5)
├── outputs.ts               # (신규) executeOutputs — DIALOG_MOVE hop, CONTEXT_FORM, unsupported 분리
├── dialogue-index.ts        # (신규) buildDialogueIndex — 정규화 사전 인덱싱(FR-E-10)
├── design-validator.ts      # (신규) validateDialogueDesign(FR-5-16) — DD-17
├── flow-tree.ts             # (신규) buildFlowTree(FR-5-19)
└── constants.ts             # (신규) DEFAULT_FALLBACK_RESPONSE, HOP_LIMIT=10, MAX_INPUT_LENGTH=1000 등
```

`index.ts` 공개 API:
```ts
export { matchIntent, matchFaq, simulate } from './matcher';              // 하위호환(deprecated 예정)
export { resolveResponse } from './resolver';
export { resolveHomonym } from './homonym';
export { advanceContextSession, startContextSession } from './context-session';
export { suggestSimilarFaqs } from './faq';
export { validateDialogueDesign } from './design-validator';
export { buildFlowTree } from './flow-tree';
export { buildDialogueIndex } from './dialogue-index';
export { normalizeText, tokenize } from './normalize';
```

### 7.2 진입점 시그니처 (FR-E-2)

```ts
export interface ResolveOptions {
  /** 사전 구축한 인덱스 재사용(FR-E-10). 미지정 시 내부에서 1회 생성한다. */
  index?: DialogueIndex;
  hopLimit?: number;          // 기본 10 (FR-5-18)
  maxInputLength?: number;    // 기본 1000 (EX-D-8)
  defaultFallbackText?: string;
}

export function resolveResponse(
  input: string,
  session: ContextSessionState | null,
  bundle: DialogueBundle,
  now: Date,
  options?: ResolveOptions,
): DialogueResolution;
```

요구사항 FR-E-2가 명시한 4-인자 시그니처를 그대로 유지하고, 확장은 선택적 5번째 인자로 흡수한다(호출부 추적성 유지). **`now`는 반드시 주입**한다 — `Date.now()`를 내부에서 부르면 세션 만료 테스트(AC-8-6)를 결정론적으로 작성할 수 없다(FR-8-9).

### 7.3 해석 우선순위 파이프라인 (FR-E-3)

```
resolveResponse(input, session, bundle, now, opts):

S0. 전처리 (PREPROCESS)
    raw = input ?? ''
    if raw.length > maxInputLength: raw = raw.slice(0, maxInputLength); trace(INPUT_TRUNCATED)   # EX-D-8
    norm = normalizeText(raw)
    if norm === '': trace(EMPTY_INPUT); return 재입력 안내 TEXT 1건 (nextSession = session 그대로)  # EX-D-7
    ctx = { raw, norm, tokens: tokenize(norm), matchedIntentId: undefined,
            completedContextVariableId: undefined }

S1. 컨텍스트 세션 (SESSION) — session?.status === 'IN_PROGRESS'일 때만
    def = bundle.contexts.find(id === session.contextVariableId)
    if !def                                   -> CANCELLED + 재시작 안내, trace(SESSION_DEFINITION_CHANGED)  # EX-S-4
    if 슬롯 구조 불일치(슬롯 수 변경/현재 인덱스 범위 밖/filledValues의 슬롯명 소실)
                                              -> CANCELLED + 값 유실 고지                                    # EX-S-4
    r = advanceContextSession(session, ctx, def, now)
      ① cancelKeywords 포함?   -> CANCELLED + "요청을 취소했어요"                    (FR-8-11, 최우선)
      ② now - lastInteractedAt > timeout -> EXPIRED + BUTTON[이어서 하기 / 처음부터]  (FR-8-12)
      ③ required=false && 입력이 SKIP_TOKENS('건너뛰기','스킵','skip') -> 다음 슬롯   (FR-8-14)
      ④ validateSlotValue(slot, raw)
           실패 -> retryCount+1; retryCount > maxRetry ? CANCELLED + 이탈 안내 : errorPrompt 재출력  (FR-8-10)
           성공 -> filledValues[slot.name] = 정규화된 값; currentSlotIndex+1
      ⑤ 남은 필수 슬롯 없음 -> COMPLETED + completionMessage({슬롯명} 치환)          (FR-8-13)
    if r.status !== 'COMPLETED': return r.outputs, nextSession = r.state   # ①~④는 여기서 종료
    # COMPLETED만 파이프라인을 계속 탄다(DD-13) — 완료 문구 뒤에 후속 노드 아웃풋을 같은 턴에 이어 붙이기 위함
    ctx.completedContextVariableId = def.id;  carry = r.outputs;  nextSession = null

S2. 동음이의어 보정 (HOMONYM)
    h = resolveHomonym(ctx, bundle.homonyms, bundle.intents)
    switch h.status:
      'RESOLVED'  -> ctx.boostIntentIds = [h.intentId]; trace(HOMONYM_RESOLVED)
      'AMBIGUOUS' -> policy==='ASK' 이면 즉시 return carry + buildClarifyOutput(h)  (FR-7-8: BUTTON 아웃풋)
      'IGNORED'   -> 아무 것도 하지 않음                                             (AC-7-6)
    ctx.matchedIntentId = matchIntent(norm, bundle.intents, { boostIntentIds })?.intentId

S3. DialogNode 매칭 (NODE)
    cands = bundle.dialogNodes.filter(n => n.enabled && n.nodeType !== 'FALLBACK')
    matched = cands.filter(n => evaluateNode(n, ctx))
    if matched.length > 0:
        node = rankNodes(matched)[0]                # FR-5-8 타이브레이크
        trace(NODE_MATCHED, node); 동률 후보 있으면 trace(NODE_TIEBREAK)
        return carry + executeOutputs(node, ...)

S4. FAQ 매칭 (FAQ)
    f = matchFaqEntry(norm, bundle.faqs.filter(enabled))     # question + altQuestions 동등 취급
    if f: trace(FAQ_MATCHED); return carry + [TEXT(f.answer)], matchedFaqId = f.id

S5. 의도 단독 (INTENT)
    if ctx.matchedIntentId: trace(INTENT_ONLY)
       return carry + [TEXT(INTENT_ONLY_RESPONSE(intentId, matchedExample))]     # 현행 simulate 문구 유지

S6. 폴백 (FALLBACK)
    ① nodeType==='FALLBACK' && enabled 노드 -> executeOutputs                    trace(FALLBACK_NODE)
    ② category==='ERROR_RESPONSE' && enabled FAQ 중 createdAt asc 첫 건          trace(FALLBACK_FAQ)
    ③ DEFAULT_FALLBACK_RESPONSE                                                  trace(FALLBACK_DEFAULT)
    # ②의 "첫 건" 선택 규칙을 고정하는 이유: 무작위/최신순은 같은 입력에 다른 응답을 주어 테스트와 운영 재현성을 깬다
```

**FR-E-3과의 차이 1건(설계 보강, 명시적)**: 요구사항은 "① 진행 중 세션이면 세션 처리(종료)"로 읽히지만, **`COMPLETED`만은 종료하지 않고 S3로 이어진다.** 그래야 FR-8-13("완료 문구 출력 뒤 노드에 지정된 후속 아웃풋으로 넘긴다")이 **같은 턴 안에서** 성립한다. `IN_PROGRESS`/`CANCELLED`/`EXPIRED`는 요구사항대로 즉시 종료한다. AC-E-7(진행 중 세션 우선)은 그대로 통과한다.

**`evaluateNode(node, ctx)`** (FR-5-2, DD-13)

| 조건 종류 | 충족 판정 |
|---|---|
| 의도 | `node.intentIds`에 `ctx.matchedIntentId`가 포함 |
| 키워드 | `node.keywordIds` 중 어느 키워드의 `name` 또는 동의어가 입력에 **단어 단위 포함**(`containsWord`) |
| 컨텍스트 | `node.contextVariableId === ctx.completedContextVariableId`(직전 턴에 해당 폼이 완료됨, DD-13) |

- **지정되지 않은 종류는 판정에서 제외**한다. `matchMode='ANY'`는 지정된 종류 중 **하나 이상** 충족, `'ALL'`은 **지정된 종류 전부** 충족. 같은 종류 내부는 항상 OR.
- 끊어진 참조 ID(삭제된 의도 등)는 조건 목록에서 **조용히 제외**하고 `trace(BROKEN_REFERENCE)`. 그 결과 조건이 0개가 되면 해당 노드는 매칭되지 않는다(AC-E-9, FR-E-9).

**`rankNodes` 정렬 키(FR-5-8, EX-D-2 — 비결정적 동작 금지)**

`priority desc` → `조건 개수 desc` → `matchMode('ALL' 우선)` → `updatedAt desc` → **`id asc`(최종 결정성 보장)**.
마지막 `id asc`는 요구사항에 없는 보강이다. 앞의 4개가 모두 동률인 노드(복사로 만들어진 쌍 등)가 실제로 존재할 수 있고, 그때 배열 순서에 의존하면 DB 반환 순서에 따라 응답이 바뀐다.

### 7.4 `executeOutputs` (FR-E-5~7)

```
executeOutputs(node, ctx, bundle, now, opts):
  out=[], unsupported=[], hops=0, nextSession=null
  queue = [...node.outputs]
  while queue.length:
    o = queue.shift()
    if !DialogOutputSchema.safeParse(o).success: trace(PAYLOAD_INVALID); continue        # FR-E-9
    switch o.type:
      TEXT|CARD|IMAGE|BUTTON|LINK|PAUSE|PHONE_CALL: out.push(o)
      CONTEXT_FORM:
        def = bundle.contexts.find(id === o.payload.contextVariableId)
        if !def: trace(BROKEN_REFERENCE); continue
        if 진행 중 세션 있음: trace(SESSION_CANCELLED) + 전환 고지 TEXT                   # EX-S-7
        out.push(첫 슬롯 prompt) ; nextSession = startContextSession(def, now)
        trace(SESSION_ADVANCED); break   # 폼 시작 이후 남은 아웃풋은 실행하지 않는다(다음 턴으로 이어짐)
      DIALOG_MOVE:
        hops++
        if hops > hopLimit: trace(HOP_LIMIT_EXCEEDED); push(안내 TEXT); break             # FR-5-18, AC-E-8
        target = bundle.dialogNodes.find(id === o.payload.targetNodeId && enabled)
        if !target: trace(BROKEN_REFERENCE); continue
        queue = [...target.outputs]      # 이동 = 전환 — 현재 노드의 남은 아웃풋은 버린다
      SCENARIO|SURVEY|API_CONDITION: unsupported.push(o.type); trace(UNSUPPORTED_OUTPUT)  # FR-E-7
  if out.length === 0:
     trace(EMPTY_OUTPUT); out = [TEXT(unsupported.length ? UNSUPPORTED_NOTICE : DEFAULT_FALLBACK_RESPONSE)]  # EX-D-6
```
- `CONTEXT_FORM`의 첫 슬롯이 `CHOICE`면 `prompt` TEXT + 선택지 `BUTTON`(action `MESSAGE`) 2건을 출력한다(AC-8-2 입력 편의).
- **어떤 경우에도 예외를 던지지 않는다**(FR-E-9). 모든 실패는 `trace` 경고 + 무시다.
- 최소 1건의 아웃풋을 항상 보장한다(AC-E-10).

### 7.5 참조 무결성 검사 위치 요약 (§8 EX-R 대응)

| 참조 | 저장 위치 | 검사 주체 | 삭제 차단 |
|---|---|---|---|
| 노드 → 의도 | **조인 테이블** | DB FK + `reference-check.service` | `INTENT_IN_USE`(DB `P2003`이 최종 방어선) |
| 노드 → 키워드 | **조인 테이블** | 동일 | `KEYWORD_IN_USE` |
| 노드 → 컨텍스트 | **FK 컬럼**(DD-6) | DB FK + 서비스 | `CONTEXT_IN_USE` |
| 동음이의어 의미 → 의도 | `meanings` JSON | 서비스(사전 항목 수가 작아 전량 스캔 허용) | `INTENT_IN_USE`(EX-R-2) |
| 컨텍스트 슬롯 → 키워드 | `slots` JSON | 서비스(챗봇당 컨텍스트 수 작음) | `KEYWORD_IN_USE`(EX-R-3) |
| 아웃풋 `DIALOG_MOVE`/버튼 `NODE` → 노드 | `outputs` JSON | 서비스(노드 ≤500건, `chatbotId` 인덱스로 한정 조회) | `NODE_IN_USE`(EX-R-5) |
| 아웃풋 `CONTEXT_FORM` → 컨텍스트 | `outputs` JSON | 서비스 | `CONTEXT_IN_USE`(FR-8-6) |

JSON 스캔 3종은 **DD-5의 문제(전체 스캔 + LIKE 부분문자열 오탐)를 반복하지 않는다** — `chatbotId`로 범위를 한정한 뒤 **JSON을 파싱해 ID를 정확 비교**하기 때문이다. DD-5가 문제였던 이유는 목록 조회마다 챗봇 전체 노드를 훑어 `linkedNodeCount`를 세야 했기 때문(N+1 × 전량 스캔)이고, 여기 3종은 **삭제 시점 1회**만 발생한다(NFR-P2 200ms 여유).

### 7.6 컨텍스트 세션 (FR-8-8~16, DD-10)

- `advanceContextSession(session, ctx, definition, now)` → `{ state, outputs }`. **순수 함수, DB·시계 무의존.**
- 슬롯 값 검증 규칙:

| type | 검증 |
|---|---|
| `TEXT` | `validation.maxLength`, `validation.pattern`(사용자 정규식은 **길이 200자 제한 + 안전 실행**: 컴파일 실패 시 검증 생략 + trace 경고) |
| `NUMBER` | 숫자 파싱(한글 수사 미지원 — AC-8-3의 "백만"은 실패가 정답) + `min`/`max` |
| `DATE` | `validation.dateFormat`의 3종만 허용, 실제 존재하는 날짜인지 확인 |
| `PHONE` | `/^0\d{1,2}-?\d{3,4}-?\d{4}$/` |
| `EMAIL` | `z.string().email()` |
| `CHOICE` | `choices`와 정규화 일치(부분 일치 허용 안 함 — 오입력 방지) |
| `KEYWORD` | 해당 키워드의 `name`/동의어와 정규화 일치 → **정규 값(`name`)으로 치환 저장** |

- 세션 상태는 **테이블을 만들지 않는다**(DD-10). No.10 시뮬레이터가 요청-응답 왕복으로 상태를 주고받는다.
- `filledValues`는 PII 가능성이 있어 스키마 JSDoc에 마스킹 대상임을 명시하고, 엔진·서비스 어디에서도 로그로 출력하지 않는다(NFR-S9).

### 7.7 설계 점검 / 흐름 요약 (DD-17)

`validateDialogueDesign(bundle, now)` → `DesignValidationReport`

| 코드 | 대상 | severity | 판정 |
|---|---|---|---|
| `EMPTY_OUTPUT` | 노드 | `WARNING` | `outputs.length === 0`(FR-5-16 ①) |
| `BROKEN_REFERENCE` | 노드 | `ERROR` | 조건·아웃풋이 가리키는 의도/키워드/컨텍스트/노드 ID 부재(②) |
| `MOVE_CYCLE` | 노드 | `WARNING` | `DIALOG_MOVE`만으로 구성한 방향 그래프에서 DFS 사이클. `path`에 `A→B→A` 수록(③, FR-5-18) |
| `DUPLICATE_CONDITION` | 노드 | `WARNING` | 정규화된 조건 집합(`intentIds`∪`keywordIds`∪`contextId`+`matchMode`)이 동일한 노드 2건 이상(④) |
| `ORPHAN_NODE` | 노드 | `INFO` | 들어오는 참조 0 + 인풋 조건 0 + `nodeType==='NORMAL'`(⑤) |
| `NO_FALLBACK_NODE` | 챗봇 | `INFO` | `FALLBACK` 노드 0건(⑥, EX-D-4) |
| `EMPTY_EXAMPLE_INTENT` | 의도 | `WARNING` | 예문 0개 의도를 조건으로 쓰는 노드 존재(⑦, EX-D-5) |
| `UNSUPPORTED_OUTPUT` | 노드 | `INFO` | `UNSUPPORTED_OUTPUT_TYPES` 사용(⑧, FR-5-15) |

- **`ERROR`가 있어도 저장/상태전환을 막지 않는다**(FR-5-17). 챗봇을 `ACTIVE`로 전환할 때 경고만 표시하며, No.1의 상태 전이 규칙은 변경하지 않는다.
- 사이클 판정은 **`DIALOG_MOVE`만** 대상이다. 버튼의 `NODE` 액션은 사용자 선택이라 무조건 이동이 아니므로 제외하고, **흐름 미리보기(`buildFlowTree`)에는 포함**한다(`via: 'BUTTON_NODE'`).
- `buildFlowTree`는 `START` 노드(없으면 `priority` 최상위)를 루트로 DFS하며, 재방문 노드는 `repeated: true`로 표시하고 더 펼치지 않는다(FR-5-19, AC-5-14). 어떤 루트에서도 도달하지 않는 노드는 `orphanNodes`로 따로 반환한다.

### 7.8 성능 — 사전 인덱싱 (FR-E-10, AC-E-12)

`buildDialogueIndex(bundle)`:

| 인덱스 | 자료구조 | 용도 |
|---|---|---|
| `exampleExact` | `Map<normalizedExample, intentId[]>` | 정확일치 O(1) |
| `examplePartial` | `{ intentId, norm }[]`(정규화 1회 캐시) | 부분일치 선형 스캔 |
| `faqExact` / `faqPartial` | 동일(질문 + 대체질문) | FAQ 매칭·유사 후보 |
| `keywordTerms` | `{ keywordId, norm }[]` | 키워드 조건 판정 |
| `nodesRanked` | `DialogNode[]`(FR-5-8 정렬 완료) | 노드 평가 순서 고정 |
| `homonymWords` | `Map<normalizedWord, HomonymDictionary>` | 동음이의어 전처리 |

- **현행 구현의 진짜 비용은 `normalize()` 반복 호출**(20,000 예문 × 매 요청)이다. 인덱스가 정규화 결과를 캐시하면 부분일치 스캔은 `String.includes` 20,000회(≈1~2ms)로 떨어진다.
- `resolveResponse`는 `options.index` 미지정 시 내부에서 1회 생성한다(AC-E-12의 100회 반복 측정에서는 인덱스를 재사용하도록 테스트를 작성한다).
- **API 서버의 번들 캐시는 이번 Phase 범위 밖**이다. 이번에 엔진을 호출하는 경로는 `POST /homonyms/test`(사전만 사용)와 `POST /dialog-nodes/validate`(요청당 1회)뿐이라 캐시가 필요 없다. 대화 API가 생기는 No.10에서 `DialogueBundleService`에 TTL/쓰기 무효화 캐시를 얹는다(인터페이스는 지금 형태 유지).

### 7.9 `simulate` 하위호환 전략 (FR-E-4, AC-E-11)

기존 테스트(`matcher.spec.ts`)가 보장하는 계약은 3가지다: ① FAQ 우선 매칭, ② 의도 매칭 시 `[id] 의도로 매칭되었습니다 (예문: "...")` 문자열, ③ 실패 시 `...이해하지 못했어요...`.

```ts
/** @deprecated No.10 Phase에서 resolveResponse로 대체 예정. 신규 호출부는 resolveResponse를 쓴다. */
export function simulate(
  input: string,
  intents: Intent[],
  faqs: FaqEntry[],
  now: Date = new Date(),     // 선택 인자 추가 — 기존 3-인자 호출은 그대로 컴파일된다
): SimulateResult {
  const bundle = { intents, faqs, keywords: [], homonyms: [], dialogNodes: [], contexts: [] };
  return toSimulateResult(resolveResponse(input, null, bundle, now));
}
```

- **`dialogNodes`가 빈 배열이므로 S3가 항상 건너뛰어지고 S4(FAQ) → S5(의도) 순서가 그대로 유지된다.** 즉 "FAQ를 의도보다 먼저 본다"는 기존 동작은 **노드가 없는 번들에서만** 성립하는 특수해였고, 새 파이프라인에서도 동일하게 재현된다. 기존 테스트는 수정 없이 통과한다.
- `toSimulateResult(resolution)`: 첫 `TEXT` 아웃풋의 `text`를 `response`에 넣고, 없으면 `DEFAULT_FALLBACK_RESPONSE`. `matchedIntentId`/`matchedFaqId`는 그대로 전달. `SimulateResultSchema`는 **변경하지 않는다**(shared-types 파괴적 변경 없음).
- `INTENT_ONLY_RESPONSE(intentId, example)`를 `constants.ts`의 함수 상수로 추출해 S5가 기존 문자열을 **글자 그대로** 생성한다.
- `matchIntent(input, intents, options?)` — 선택 3번째 인자 `{ boostIntentIds?: string[] }` 추가(기존 2-인자 호출 호환). 부스트는 동점 시 우선 선택에만 쓰고 점수 체계를 바꾸지 않는다.
- `matchFaq(input, faqs)` — 시그니처 불변. 내부에서 `enabled ?? true` 필터와 `altQuestions ?? []` 확장을 적용한다(기존 fixture에 두 필드가 없어도 동작).
- **동작 변화 지점을 테스트로 고정**(FR-E-4): "같은 입력에 노드와 FAQ가 모두 매칭될 때 노드가 이긴다"(AC-E-2)를 신규 테스트로 명시하고, 주석에 "노드가 있는 번들에서는 FAQ보다 노드가 우선한다"를 남긴다.

---

## 8. 핵심 로직 규격 (서버 측)

### 8.1 정규화 유일성 쓰기 절차 (ADR-0006)

```
create/update(name):
  trimmed = name.trim()
  normalized = normalizeText(trimmed)
  try { prisma.create({ name: trimmed, nameNormalized: normalized, ... }) }
  catch (P2002 on (chatbotId, nameNormalized)) { throw ApiException(409, DUPLICATE_NAME) }
```
사전 `findFirst` 검사는 **UX용(빠른 400/409 안내)**, DB 유니크는 **최종 방어선**이다. 둘 다 둔다(ADR-0002의 "사전검사=UX, 제약=방어선" 역할 분담과 동일).

### 8.2 예문/동의어/대체질문 집합 처리

| 대상 | 규칙 |
|---|---|
| 예문(FR-6-5) | 정규화 기준 dedupe → 첫 등장 원문 보존 → `deduplicatedCount` 반환. 오류 아님 |
| 예문 개수(FR-6-6) | `기존 + 추가 > 500` → `400 LIMIT_EXCEEDED`(현재 개수 포함) |
| 예문 교차 충돌(FR-6-7) | 같은 챗봇의 **다른 의도** 예문 집합과 교집합 → `conflicts[]`로 반환, **저장은 허용** |
| 동의어(FR-6-16) | 같은 챗봇의 다른 키워드의 `name`+동의어와 교집합 → **`409 SYNONYM_CONFLICT`(차단)** |
| 대체질문(FR-9-4) | `question` + `altQuestions` 정규화 집합이 같은 챗봇의 기존 집합과 교집합 → `409 DUPLICATE_FAQ` |

> **경합 안전성**: 동의어·대체질문 충돌은 DB 유니크로 표현할 수 없어 서비스 사전검사에 의존한다. **검사와 쓰기를 같은 `prisma.$transaction` 안에서 수행**한다. 현재 dev DB인 SQLite는 쓰기를 직렬화하므로 이것으로 충분하다. Postgres 전환 시에는 `SELECT ... FOR UPDATE` 또는 별도 유니크 테이블이 필요함을 §12에 후속 과제로 기록한다.

### 8.3 FAQ 유사 후보 (FR-9-5, NFR-P4)

`suggestSimilarFaqs(q, faqs, limit=5)` — 엔진 순수 함수. 점수 = 아래 중 **최댓값**.

| 규칙 | 점수 |
|---|---|
| 접두 일치(`norm.startsWith(q)` 또는 역방향) | `0.9 + 0.1 × 길이비` |
| 부분 문자열 포함 | `0.7 × 길이비` |
| 공백 토큰 자카드 ≥ 0.5 | `0.5 + 0.4 × (jaccard - 0.5) / 0.5` |

- 정확 일치(`=== q`)는 제안이 아니라 **`409 DUPLICATE_FAQ`의 영역**이므로 후보에서 제외한다.
- 임베딩 의미 유사도는 No.18 범위다(요구사항 §9.3). 규칙 기반의 한계는 관리자 안내 문구로 고지한다.

### 8.4 대량 업로드 파이프라인 (FR-6-19~30, ADR-0007)

```
validate(file):
  1) 확장자 + MIME 동시 검증(FR-6-29) / 크기 ≤ 5MB → 초과 시 IMPORT_TOO_LARGE
  2) reader = pickSheetReader(ext)        # CsvSheetReader | XlsxSheetReader
  3) rows = reader.read(buffer)           # 5,001행째에서 즉시 중단 → IMPORT_TOO_LARGE (NFR-S6 압축폭탄 방어)
  4) 헤더 검증(한국어/영문 별칭) → 불일치 시 IMPORT_FILE_INVALID (EX-I-1)
     UTF-8 디코딩 실패/치환문자(U+FFFD) 비율 > 5% → IMPORT_FILE_INVALID (EX-I-2)
     데이터 행 0 → IMPORT_FILE_INVALID (EX-I-4)
  5) parseRows(rows)  # 순수 — 행 오류 코드 판정(FR-6-23), 파일 내 중복 집계(EX-I-3)
  6) planImport(parsed, 기존 데이터)  # 순수 — newItems/updatedItems/newValues/conflicts 산출
  7) token = randomUUID(); stagingStore.set(token, { chatbotId, resourceType, plan, expiresAt: now+10분 })
  8) return 리포트 (DB 쓰기 0건 — AC-6B-2)

commit({ importToken, mergePolicy, errorPolicy }):
  staged = stagingStore.take(token)
  if !staged || expired            -> 400 IMPORT_TOKEN_EXPIRED
  if staged.chatbotId !== :chatbotId -> 404      # 토큰 교차 사용 차단
  if errorPolicy==='ABORT_ON_ERROR' && plan.errors.length -> 400 IMPORT_ABORTED (AC-6B-4)
  prisma.$transaction(async tx => {              # 단일 트랜잭션(FR-6-26, AC-6B-5)
     mergePolicy별 적용: MERGE(예문 합집합) / REPLACE(전체 교체) / SKIP(해당 항목 건너뜀)
     createMany / updateMany 배치 — 행 단위 개별 INSERT 금지(NFR-P6)
  })
  stagingStore.delete(token)                     # 1회용 — 중복 커밋 차단(AC-6B-10 연타 방어의 서버측 보강)
```
- 수식 인젝션(FR-6-29, EX-I-5): 셀 값은 **그대로 저장**하고, **내보내기/템플릿 생성 시** `escapeCsvCell()`이 `= + - @` 시작 값 앞에 `'`를 붙인다.
- 내보내기는 **UTF-8 BOM을 포함**해 Excel에서 한글이 깨지지 않게 한다(AC-C-7, AC-6B-9).

### 8.5 노드 저장 트랜잭션 (DD-5, DD-15)

```
saveNode(dto):
  1) ChatbotScopeService.assertWritable
  2) zod 검증(판별 유니온 payload 포함) → 실패 400 OUTPUT_PAYLOAD_INVALID
  3) 참조 검증: intentIds/keywordIds/contextVariableId/아웃풋 내 targetNodeId·contextVariableId
       같은 챗봇에 실존하는지 일괄 조회(1쿼리씩) → 누락 시 404 INVALID_REFERENCE(details에 문제 ID)
  4) nodeType 단일성: START/FALLBACK 지정 시 기존 보유 노드 조회 → 409 *_NODE_EXISTS
  5) prisma.$transaction:
       upsert dialog_nodes(본체 + outputs JSON + nameNormalized)
       deleteMany dialog_node_intents where nodeId          # DD-15 — 명시적 선삭제
       createMany dialog_node_intents (diff 결과)
       (키워드도 동일)
  6) mapper가 링크 → intentIds[] 로 복원해 응답
deleteNode(id):
  1) 참조 사전검사: 이 노드를 DIALOG_MOVE/버튼 NODE로 가리키는 노드 → 409 NODE_IN_USE
  2) $transaction: deleteMany 링크 2종 → delete 노드
```
`linkedNodeCount`(FR-6-8, FR-6-17)는 **`prisma.intent.findMany({ include: { _count: { select: { nodeLinks: true } } } })` 1쿼리**로 해결된다 — N+1도, JSON LIKE 오탐도 없다(ADR-0005의 핵심 이득).

---

## 9. 프런트엔드 인계 제약 (`apps/web`)

| 항목 | 내용 |
|---|---|
| 탭 구조 | 기존 3탭(`dashboard`/`settings`/`skin`)에 5개를 평면 추가하면 8탭이 되어 과밀하다. **"대화설계" 상위 탭 1개 + 좌측 서브내비 5종**(대화그래프/의도·키워드/동음이의어/컨텍스트/FAQ)을 권고하며 최종 판단은 `ui-designer`(요구사항 §11) |
| 라우팅 | `/chatbots/:id/dialogue/{nodes\|intents\|homonyms\|contexts\|faqs}` — 서브내비도 URL 세그먼트로 두어 새로고침·딥링크·뒤로가기가 동작해야 한다(기존 탭 규약 승계) |
| 재사용 | `UnsavedGuardContext`(NFR-A9), `ConfirmDialog`(AC-C-6), `Toast`, `MESSAGES` 상수(FR-0-8) 그대로 사용 |
| 신규 공통 컴포넌트 | ① 파일 업로드 + 진행/오류 표시 ② 검증 리포트 표(행 번호·사유·바로가기, NFR-A4) ③ 순서 변경 리스트(위/아래 버튼, **드래그 금지**, NFR-A1, AC-5-8 포커스 유지) ④ 리소스 선택기(검색 가능한 목록, ID 직접 입력 금지 — FR-5-20) ⑤ 심각도 배지(색상+텍스트 병기, NFR-A3) |
| 오류 처리 | `apiClient`는 이미 `ApiErrorSchema`를 파싱한다. 신규 `code` 16종에 대한 분기·문구를 `messages.ts`에 추가 |
| 클라이언트 전용 | 슬롯 대화 미리보기(FR-8-7), 오류 행 CSV 생성(DD-16), 중복 입력 사전 경고(`normalizeText` 공유, FR-9-4 디바운스 400ms) |
| 접근성 | 아웃풋 12종 편집 폼은 타입별 필드가 달라지므로 **타입 변경 시 포커스를 첫 필드로 이동**시키고, `IMAGE`/`CARD`의 대체 텍스트는 필수 표시(NFR-A7) |

---

## 10. seed 전략 (NFR-M5)

`apps/api/prisma/seed.ts`를 확장한다(멱등 유지 — 챗봇 slug 기준 upsert 후 대화 자산은 `deleteMany` → 재생성).

| 챗봇 | 내용 | 검증 목적 |
|---|---|---|
| `sample-support-bot` | 의도 5건(예문 포함, 그중 1건은 **예문 0개** — EX-D-5), 키워드 3건(`택배사` 동의어 4개 포함), 동음이의어 1건(`배` 의미 3종·정책 `ASK`), 컨텍스트 1건(`커피주문` 슬롯 3개: CHOICE/CHOICE/NUMBER), 노드 4건(`START`·`NORMAL` 2·`FALLBACK`), FAQ 4종 카테고리 각 1건 + 대체질문 보유 1건 + `enabled=false` 1건 | AC-5/6/7/8/9 대부분, AC-E-1~E-10 |
| `empty-dashboard-bot` | **대화 자산 0건 유지** | 빈 상태 AC(AC-5-13, AC-9-6, EX-D-9, NFR-A8) |
| `archived-legacy-bot` | 변경 없음 | AC-C-2(ARCHIVED 쓰기 409) |

- 노드 중 1건은 `DIALOG_MOVE`로 다른 노드를 가리키고, 그 노드가 되돌아오게 해 **순환 경고(AC-5-9)** 를 재현한다.
- 노드 중 1건에 `SURVEY` 아웃풋을 넣어 **미지원 배지·`unsupportedOutputs`(AC-5-7, EX-D-6)** 를 재현한다.
- 성능 테스트(AC-E-12)용 대량 fixture는 seed가 아니라 **테스트 전용 생성 스크립트**로 만든다(`test-automation` 인계).

---

## 11. 요구사항 ↔ 설계 추적표 (발췌)

| 요구사항 | 설계 반영 위치 |
|---|---|
| FR-0-9(중첩 경로) / §10 상위문서 정정 | §5.1, §5.3, 개발명세서 §4 갱신 |
| FR-0-10(삭제 409 + 참조 목록) | §5.4, §7.5, `reference-check.service` |
| FR-0-12(정규화 단일 소스) | §2.3 DD-11, `shared-types/common.ts` |
| FR-0-13 / AC-6-2 | ADR-0006, §3.1, §8.1 |
| FR-5-8 / EX-D-2 | §7.3 `rankNodes`(+`id asc` 보강) |
| FR-5-13 / AC-5-5, AC-5-6 | §4.3 판별 유니온 12종 |
| FR-5-16~19 / AC-5-9, AC-5-10, AC-5-14 | §7.7 `validateDialogueDesign` / `buildFlowTree` |
| FR-6-8 / FR-6-11 / AC-6-6 | **ADR-0005**, §8.5 `_count` 1쿼리 |
| FR-6-13 / AC-6-8(부분 성공 금지) | §5.2 #7, 단일 트랜잭션 |
| FR-6-19~30 / AC-6B-1~10 | **ADR-0007**, §4.5, §8.4 |
| FR-7-4 / AC-7-2 | §4.2(c) `superRefine` |
| FR-7-7, FR-7-8 / AC-7-4~7-6 | §7.3 S2, `buildClarifyOutput`(BUTTON 재사용) |
| FR-8-8~16 / AC-8-1~8-8 | §7.6, `dialogue-engine.ts` 세션 스키마 |
| FR-9-4, FR-9-5 / AC-9-2, AC-9-3 | §8.2, §8.3 |
| FR-9-11 / AC-9-7 | `answer` 평문 저장 + 프런트 이스케이프(NFR-S2) |
| FR-E-2, FR-E-3 / AC-E-1~E-10 | §7.2, §7.3 |
| FR-E-4 / AC-E-11 | §7.9 `simulate` 위임 + 선택 인자 |
| FR-E-7 / AC-5-7, EX-D-6 | §7.4 `unsupportedOutputs`, `UNSUPPORTED_OUTPUT_TYPES` 상수 |
| FR-E-10 / AC-E-12 | §7.8 `buildDialogueIndex` |
| NFR-P1, NFR-P2 | ADR-0005(조인테이블), DD-9 인덱스 |
| NFR-S4, NFR-S5 | §4.3 `API_CONDITION` 주석, §12 |
| NFR-M1, NFR-M3 | §6 계층표, §7 엔진 순수 함수 |

---

## 12. 이 Phase에서 하지 않는 것 (아키텍처 관점 재확인)

요구사항 §9를 승계한다. 특히 명시해 둘 항목:

- **`apps/ml-worker`·Redis/BullMQ·pgvector·docker-compose 미도입**(개발명세서 §6-4 유지). 임베딩 의미 유사도(No.18), DLE 증강학습(No.16)은 이번 매칭 품질의 한계를 아는 상태로 **의도적으로** 미룬다 — 규칙 기반 매칭의 한계는 관리자가 예문·대체질문을 늘려 대응한다(EX-X-5).
- **대화 REST/WS API·채널 어댑터·아웃풋 렌더링 없음**(No.10/No.11). 엔진은 순수 함수와 단위 테스트까지다.
- **세션 영속화 테이블/만료 배치 없음**(DD-10).
- **캔버스 좌표·엣지 테이블 없음**(DD-2, DD-14) — 도입 시 한 번에 설계한다.
- **`FaqEntry.keywordIds` 없음**(DD-3, PM 확인 항목).
- **`API_CONDITION`의 SSRF 방어·헤더 암호화 없음** — 저장/형식 검증까지. 실행 Phase(No.26)가 사설 IP 대역(`127/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`) 차단과 헤더 비밀값 암호화를 반드시 구현해야 한다(NFR-S4, NFR-S5).
- **낙관적 잠금 없음** — last-write-wins 유지(EX-X-2, No.1 D-4 승계).
- **Postgres 전환 시 재검토 과제 2건**: ① 동의어·대체질문 충돌의 경합 안전성(§8.2) ② `CREATE UNIQUE INDEX CONCURRENTLY` 적용(§3.2).
