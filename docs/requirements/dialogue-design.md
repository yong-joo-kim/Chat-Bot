# 대화 설계(빌더) (기능그룹) — 요구사항 정의서

> **대상 기능**: `docs/01-requirements/기능요구사항.md` §2 기본기능 No.5~9
> | No | 기능명 | GPU | 구축형 | 구독형 |
> |---|---|---|---|---|
> | 5 | 대화 그래프(시나리오) 빌더 | 1 | ○ | ○ |
> | 6 | 의도(Intent)·키워드(Entity) 관리 | 2 | ○ | ○ |
> | 7 | 동음이의어/다의어 사전 | 1 | ○ | ○ |
> | 8 | 컨텍스트(멀티턴·슬롯필링) 관리 | 1 | ○ | ○ |
> | 9 | FAQ 관리 | 2 | ○ | ○ |
>
> **선행 문서**: `docs/01-requirements/기능요구사항.md`, `docs/02-spec/개발명세서.md`(§2.1 계층규약, §3 데이터모델, §4 API 공통규약, §6 결정사항), `docs/03-design/UIUX_준수기준.md`
> **선행 그룹**: `docs/requirements/chatbot-operations.md`(No.1~4 요구사항), `docs/02-spec/chatbot-operations-설계.md`(4계층/오류봉투/삭제정책 등 확정 컨벤션) — 본 문서는 그 규약을 **상속**한다.
> **선행 산출물(Phase 0 스캐폴딩분)**: `packages/shared-types/src/dialogue.ts`, `packages/dialogue-engine/src/matcher.ts`, `apps/api/prisma/schema.prisma`의 `Intent`/`Keyword`/`HomonymDictionary`/`DialogNode`/`ContextVariable`/`FaqEntry`
> **작성일**: 2026-09-19 · **다음 단계**: `system-architect` → `ui-designer` → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`

---

## 1. 배경 / 목적

### 1.1 배경

1차 개발 범위(기본기능 No.1~15, `개발명세서.md` §6-3) 중 **첫 번째 그룹(챗봇 운영관리 No.1~4)** 은 요구사항→설계→구현→리뷰→테스트를 거쳐 `main`(커밋 `a90187c`)에 병합되었다. 그 결과 **`Chatbot` 루트 엔터티와 4계층 모듈 컨벤션, 오류 봉투, 삭제 정책(`onDelete: Restrict` + 사전검사 409)** 이 확정되었다.

본 문서가 다루는 **대화 설계(빌더) 5종(No.5~9)** 은 다음 이유로 두 번째 구현 대상이다.

- **챗봇의 "내용물"을 만드는 그룹**이다. No.1~4가 껍데기(그룹/설정/스킨/임베드)를 만들었다면, 이 그룹은 챗봇이 실제로 무엇을 말할지 정의한다.
- GPU 필요도 1~2(규칙 기반 CRUD·경량 매칭)로 `apps/ml-worker` 없이 `apps/api` + `packages/dialogue-engine`에서 동기 처리 가능하다(`개발명세서.md` §1 설계원칙).
- 후속 그룹인 **No.10(응답 테스트/시뮬레이션)·No.11(채널)·No.15(학습현황)** 이 전부 이 그룹이 생산한 데이터(의도/FAQ/노드/컨텍스트)를 소비한다. 즉 이 그룹이 **대화 파이프라인의 데이터 공급원**이다.

### 1.2 목적

1. 챗봇 관리자가 **코드 없이** 인풋 조건(의도/키워드/컨텍스트)과 아웃풋(12종)을 조합해 대화 흐름을 설계하게 한다(No.5).
2. 의도·키워드를 **엑셀/CSV 대량 업로드**로 빠르게 구축·유지보수하게 한다(No.6).
3. 동음이의어/다의어로 인한 **오매칭을 사전으로 교정**하고, 모호할 때 사용자에게 되묻게 한다(No.7).
4. 여러 턴에 걸쳐 항목을 채우는 **슬롯필링형 폼 대화**(예: 커피 주문)를 설계·실행하게 한다(No.8).
5. FAQ/스몰톡/셀프서비스/오류응답 세트를 **분류 관리**하고 중복 등록을 예방한다(No.9).

### 1.3 이 문서의 핵심 전제 — 매칭 엔진의 공백 (⚠ 최우선 리스크)

현재 `packages/dialogue-engine/src/matcher.ts`의 `matchIntent`/`matchFaq`/`simulate`는 **`DialogNode`를 전혀 참조하지 않는다.** 의도 예문과 FAQ 질문만 직접 비교한다.

```
현재:  입력 → matchFaq → (없으면) matchIntent → (없으면) fallback 문구
필요:  입력 → [컨텍스트 세션 진행 중?] → [동음이의어 보정] → DialogNode 조건평가 → outputs 실행
```

따라서 **No.5 대화그래프 빌더로 아무리 노드를 잘 만들어도 현재 엔진에서는 단 한 번도 실행되지 않는다.** 이 그룹은 CRUD 화면만 만들어서는 "동작하는 기능"이 되지 못하므로, **대화그래프 실행기(`resolveDialogNode` / `executeOutputs`)를 `packages/dialogue-engine`에 추가하는 것을 이 그룹의 필수 범위에 포함**한다(§4.6 FR-E). 실행기는 DB·Nest 무의존 **순수 함수**로 구현하고, 실제 채널 렌더링·세션 영속화·대화 API(REST/WS)는 No.10/No.11 Phase로 넘긴다(§9).

### 1.4 범위 경계 요약

| 구분 | 이번 Phase | 다음 Phase |
|---|---|---|
| 대화그래프 편집 | 리스트/폼 기반 CRUD + 읽기전용 흐름 요약 뷰 | **드래그앤드롭 비주얼 캔버스**(§9.2에 근거 기재) |
| 대화그래프 실행 | 엔진 코어(순수 함수) + 단위 테스트 | 시뮬레이터 UI·대화 API·채널 렌더링(No.10, No.11) |
| 아웃풋 12종 | 전 타입 **정의·저장·검증**, 9종은 실행까지 | `SCENARIO`/`SURVEY`/`API_CONDITION` 3종 실행(No.26, No.27) |
| 컨텍스트 세션 | 상태 전이 로직(순수 함수) + 상태 스키마 | 세션 영속화/만료 스케줄러(대화처리 Phase) |
| 학습/증강 | 없음(규칙 기반만) | DLE 증강학습(No.16), 임베딩 유사도(No.18) |

---

## 2. 사용자 역할 및 시나리오

### 2.1 역할

| 역할 | 이 그룹에서의 활동 |
|---|---|
| 챗봇 관리자(Admin) | 의도/키워드/FAQ/노드/컨텍스트 전 CRUD, 대량 업로드, 설계 점검 |
| 대화 설계자(Content Editor) | 실무상 Admin과 동일 권한으로 가정(별도 역할 분리는 No.12) |
| 운영 모니터(Viewer) | 조회 전용 |
| 최종 사용자(End User) | 직접 접근 없음 — 여기서 설계한 흐름의 **소비자**(실제 대화는 No.10/11에서 연결) |

> 인증·RBAC은 No.12 범위다. 이번에도 컨트롤러에 `@RequirePermission('dialogue:read'|'dialogue:write')` 데코레이터만 부착하고 가드는 no-op을 유지한다(`개발명세서.md` §4.1).

### 2.2 사용자 시나리오

**S-1. 의도 뼈대 만들기 (관리자, No.6)**
관리자가 "주문 상담봇"의 `대화설계 > 의도·키워드` 화면에서 `+ 의도 추가`로 `주문_배송조회`를 만들고 예문 5개("배송 어디까지 왔어요", "택배 조회" 등)를 입력한다. 저장 즉시 의도 목록에 예문 수 배지가 표시된다.

**S-2. 엑셀로 1,000개 예문 한 번에 등록 (관리자, No.6)**
기존에 운영하던 시트를 올리기 위해 `엑셀 업로드`를 누른다. 먼저 `템플릿 다운로드`로 2열(`의도명`, `예문`) 양식을 받아 값을 채워 업로드한다. 시스템은 **바로 저장하지 않고 검증 리포트**를 먼저 보여준다 — "신규 의도 18건 / 예문 962건 추가 / 중복 예문 31건 무시 / 오류 7건(행 번호·사유 표기)". 관리자는 "유효한 행만 반영"을 선택해 확정한다.

**S-3. 키워드(엔티티)와 동의어 정리 (관리자, No.6)**
`택배사`라는 키워드에 동의어 `우체국, CJ대한통운, 한진, 롯데` 를 등록한다. 이후 대화 노드의 인풋 조건에서 이 키워드를 선택할 수 있다.

**S-4. 오매칭 교정 (관리자, No.7)**
테스트 중 "배"라는 단어 때문에 `과일_문의`와 `선박_운항` 의도가 뒤섞이는 것을 발견한다. `동음이의어 사전`에 단어 `배`를 등록하고 의미 3개(과일/신체/선박)와 각 의미의 **문맥 힌트 키워드**(사과·포도 / 아프다·통증 / 항구·운항)와 **연결 의도**를 지정한다. 힌트가 하나도 없으면 챗봇이 "어떤 '배'를 말씀하시나요?"라고 버튼으로 되묻게 설정한다.

**S-5. 멀티턴 주문 폼 설계 (관리자, No.8)**
`커피주문` 컨텍스트를 만들고 슬롯 3개(`메뉴`(선택형: 아메리카노/라떼), `사이즈`(선택형), `수량`(숫자 1~10))를 순서대로 정의한다. 각 슬롯에 질문 문구, 잘못 입력했을 때의 재질문 문구, 최대 재시도 2회를 설정한다. 3개가 다 채워지면 요약 확인 문구를 출력하도록 완료 아웃풋을 지정한다.

**S-6. 노드로 흐름 엮기 (관리자, No.5)**
`대화그래프` 화면에서 `+ 노드 추가`로 `배송조회_응답` 노드를 만든다. 인풋 조건에 의도 `주문_배송조회`를 선택하고, 아웃풋으로 ① 텍스트("운송장 번호를 확인해 드릴게요") ② 버튼(‘배송 조회’, ‘상담원 연결’) 두 개를 순서대로 추가한다. 상단 `흐름 미리보기`에서 이 노드가 `상담원_연결` 노드로 이어지는 연결을 목록 형태로 확인한다.

**S-7. 설계 점검 (관리자, No.5)**
배포 전 `설계 점검` 버튼을 누른다. "아웃풋이 비어 있는 노드 2건", "삭제된 의도를 참조하는 노드 1건", "무한 이동 루프 가능성 1건(A→B→A)", "같은 조건을 가진 중복 노드 2건"이 경고로 나열되고, 각 항목을 클릭하면 해당 노드 편집 화면으로 이동한다.

**S-8. FAQ 정리와 중복 방지 (관리자, No.9)**
`FAQ` 화면에서 분류를 `FAQ`로 두고 "영업시간이 어떻게 되나요?"를 입력하는 순간, 시스템이 "이미 비슷한 FAQ가 있습니다: ‘영업시간 알려주세요’"를 추천으로 표시한다. 관리자는 새로 만들지 않고 기존 항목에 **대체 질문**으로 추가한다.

**S-9. 삭제하려다 막히는 경우 (관리자, 공통)**
더 이상 쓰지 않는 의도 `주문_배송조회`를 삭제하려 하자, "이 의도를 사용하는 대화 노드가 2건 있습니다"라는 안내와 함께 **해당 노드 목록 링크**가 표시되고 삭제가 거부된다. 관리자는 노드에서 조건을 먼저 정리한 뒤 다시 삭제한다.

**S-10. 다국어/특수 입력 (관리자, 공통)**
영문·일문 예문, 이모지 포함 FAQ 답변을 저장해도 깨지지 않고 그대로 표시된다. 단 관리자 콘솔 UI 레이블 자체는 한국어 고정이다.

---

## 3. 공통 기능 요구사항 (FR-0)

`chatbot-operations.md` §3의 FR-0-1~FR-0-8을 **그대로 상속**하며, 이 그룹 고유 규약을 추가한다.

| ID | 요구사항 | 비고 |
|---|---|---|
| FR-0-9 | 이 그룹의 모든 리소스는 **챗봇 스코프**다. 경로는 `/api/v1/chatbots/:chatbotId/{intents｜keywords｜homonyms｜contexts｜dialog-nodes｜faqs}` 중첩 형태로 통일한다. 다른 챗봇의 리소스 ID를 교차 참조하면 `404`로 처리한다(정보 노출 방지). | `개발명세서.md` §4 경로 갱신 필요(§10) |
| FR-0-10 | 모든 삭제는 **참조 사전 검사 → `409`** 정책을 따른다(암묵 cascade 금지, ADR-0002). 오류 응답에는 `details`에 참조 중인 리소스 종류·건수를 담고, 가능하면 상위 5건의 `{id, name}`을 함께 반환해 UI가 바로가기를 제공할 수 있게 한다. | §8 예외표 |
| FR-0-11 | 챗봇 상태가 `ARCHIVED`이면 이 그룹의 **모든 쓰기 API를 `409`(`CHATBOT_ARCHIVED`)로 거부**한다. 조회는 허용한다. | FR-1-18 일관성 |
| FR-0-12 | 텍스트 비교·중복 판정·매칭은 **공통 정규화 함수** 하나(`normalize`: trim → 소문자 → 연속 공백 1칸 축약)를 사용한다. 정규화 규칙은 `packages/dialogue-engine`에 단일 소스로 두고 API 서버도 이를 재사용한다(엔진과 서버의 중복 판정이 어긋나지 않도록). | 매칭 일관성 |
| FR-0-13 | 이름 유일성은 **`(chatbotId, 정규화된 name)`** 기준이다. 의도명/키워드명/컨텍스트명/동음이의어 단어에 적용하며 위반 시 `409`. | §8 |
| FR-0-14 | 목록 API는 `q`(이름·내용 부분 일치), 정렬(`name`/`createdAt`/`updatedAt` × `asc`/`desc`, 기본 `updatedAt desc`), 페이지네이션(FR-0-5)을 공통 제공한다. | |
| FR-0-15 | 대량 작업(업로드/일괄삭제)을 제외한 모든 변경은 단건 트랜잭션이며, 서비스 계층 단일 진입점을 유지해 향후 `AuditLog`(No.13) 기록 지점이 되게 한다. | FR-0-7 상속 |
| FR-0-16 | 이 그룹이 생성하는 데이터는 **매칭 엔진의 입력**이므로, 저장 시점에 엔진이 요구하는 불변식(빈 문자열 예문 금지, 중복 예문 제거, 참조 ID 유효성)을 **서버에서 강제**한다. 엔진이 런타임에 방어적으로 무시하는 것에 의존하지 않는다. | §4.6 |

---

## 4. 기능별 요구사항

### 4.1 No.6 — 의도(Intent)·키워드(Entity) 관리

> 다른 기능들이 의도/키워드를 참조하므로 **가장 먼저 구현**할 것을 권고한다(구현 순서: No.6 → No.7 → No.9 → No.8 → No.5 → 엔진 통합).

#### 4.1.1 의도 CRUD

| ID | 요구사항 |
|---|---|
| FR-6-1 | 의도를 생성할 수 있다. 입력: `name`(필수, 1~100자), `description`(선택, 최대 300자), `examples`(선택, 문자열 배열). |
| FR-6-2 | `name`은 `(chatbotId, 정규화 name)` 기준 유일하다(FR-0-13). 위반 시 `409` + "이미 같은 이름의 의도가 있습니다". |
| FR-6-3 | `name`에는 개행·탭을 허용하지 않는다. 양끝 공백은 저장 시 자동 trim한다. |
| FR-6-4 | `examples`의 각 예문은 1~200자이며, **빈 문자열/공백만 있는 예문은 저장 거부**(`400`)한다. |
| FR-6-5 | 동일 의도 내 **정규화 기준 중복 예문은 자동 제거**하고, 제거 건수를 응답 메타(`deduplicatedCount`)로 알린다. 오류가 아니다. |
| FR-6-6 | 의도 1건당 예문은 최대 **500개**로 제한한다. 초과 시 `400` + 현재 개수 안내. |
| FR-6-7 | **예문 교차 충돌 감지**: 저장하려는 예문이 *다른* 의도에 이미 존재하면, 저장은 허용하되 응답에 `conflicts: [{ example, intentId, intentName }]`를 포함하고 UI는 경고 배너로 표시한다(차단 아님 — 매칭 정확도 저하 경고). |
| FR-6-8 | 의도 목록은 `id`, `name`, `description`, `exampleCount`, `linkedNodeCount`(이 의도를 참조하는 `DialogNode` 수), `updatedAt`을 반환한다. |
| FR-6-9 | 의도 단건 조회 시 `examples` 전체와 이 의도를 참조하는 노드 목록(`{id, name}`)을 함께 반환한다. |
| FR-6-10 | 의도를 수정할 수 있다(PATCH, 부분 수정). `examples`는 **전체 교체(replace)** 시맨틱이며, 별도로 예문 단건 추가/삭제 엔드포인트도 제공한다(대량 예문 편집 시 전체 전송 부담 방지). |
| FR-6-11 | 의도를 삭제할 수 있다. **참조하는 `DialogNode`가 1건 이상이면 `409`**(FR-0-10). `HomonymDictionary`의 의미가 이 의도를 연결하고 있어도 `409`로 거부한다. |
| FR-6-12 | 참조가 없는 의도의 삭제는 `204`로 성공한다. 삭제 확인 모달에 "예문 N개가 함께 삭제됩니다"를 명시한다. |
| FR-6-13 | 의도 다건 선택 삭제(일괄 삭제)를 제공한다. 일부가 참조 중이면 **전체를 롤백**하고 `409`와 함께 차단된 항목 목록을 반환한다(부분 성공 금지 — 관리자 혼란 방지). |

#### 4.1.2 키워드(엔티티) CRUD

| ID | 요구사항 |
|---|---|
| FR-6-14 | 키워드를 생성/조회/수정/삭제할 수 있다. 입력: `name`(필수, 1~100자), `synonyms`(문자열 배열, 각 1~100자, 최대 200개). |
| FR-6-15 | `name`은 `(chatbotId, 정규화 name)` 유일(FR-0-13). 동의어는 키워드 내부에서 정규화 기준 중복 제거한다. |
| FR-6-16 | **동의어 교차 충돌**: 같은 챗봇의 다른 키워드가 동일 동의어(또는 `name`)를 갖고 있으면 `409`로 거부한다. 키워드는 값→개념 사전이므로 의도 예문과 달리 **모호성을 허용하지 않는다**. 오류 메시지에 충돌 키워드명을 포함한다. |
| FR-6-17 | 키워드 목록은 `synonymCount`, `linkedNodeCount`를 포함한다. |
| FR-6-18 | 키워드 삭제 시 참조 `DialogNode`가 있으면 `409`(FR-0-10). |

#### 4.1.3 엑셀/CSV 대량 업로드 (매뉴얼 원본 명시 기능)

| ID | 요구사항 |
|---|---|
| FR-6-19 | 의도용/키워드용 **템플릿 파일 다운로드**를 제공한다. 포맷은 **2열 행단위**로 고정한다 — 의도: `intentName, example` / 키워드: `keywordName, synonym`. (열 개수 가변 방식은 엑셀 병합·빈칸 문제로 오류율이 높아 채택하지 않는다.) 선택 3열 `description`을 허용한다. |
| FR-6-20 | 업로드 허용 형식은 `.xlsx`, `.csv`(UTF-8, BOM 허용)다. 최대 파일 크기 **5MB**, 최대 **5,000행**. 초과 시 `400`. |
| FR-6-21 | 업로드는 **2단계**다. ① `POST .../import/validate`(dry-run) → 검증 리포트 반환, 저장 없음. ② `POST .../import/commit` → ①의 `importToken`과 사용자가 고른 옵션으로 실제 반영. `importToken`은 서버 메모리/임시 저장에 **10분** 유효. |
| FR-6-22 | 검증 리포트는 다음을 포함한다: `totalRows`, `newIntents`, `updatedIntents`, `newExamples`, `duplicatedRows`(무시 대상), `errors: [{ row, column, value, code, message }]`, `conflicts`(FR-6-7과 동일 개념). |
| FR-6-23 | 행 단위 오류 코드: `EMPTY_NAME`, `EMPTY_VALUE`, `TOO_LONG`, `INVALID_CHAR`(개행/제어문자), `DUPLICATE_IN_FILE`, `SYNONYM_CONFLICT`. 각 오류는 **행 번호(1-base, 헤더 제외)** 를 반드시 포함한다. |
| FR-6-24 | 기존 의도와 이름이 겹칠 때의 병합 정책을 사용자가 선택한다: `MERGE`(기존 예문에 추가, **기본값**) / `REPLACE`(기존 예문 전체 교체) / `SKIP`(해당 의도 건너뜀). |
| FR-6-25 | 오류 행 처리 정책을 사용자가 선택한다: `SKIP_INVALID`(유효 행만 반영, 기본값) / `ABORT_ON_ERROR`(오류 1건이라도 있으면 전체 취소). |
| FR-6-26 | 커밋은 **단일 DB 트랜잭션**으로 처리한다. 중간 실패 시 전체 롤백하고 어떤 행도 반영하지 않는다. |
| FR-6-27 | 커밋 결과 요약(반영 건수 + 오류 행)을 화면에 표시하고, **오류 행만 담은 CSV 다운로드**를 제공해 관리자가 수정 후 재업로드할 수 있게 한다. |
| FR-6-28 | 업로드/검증 진행 중에는 스피너와 진행 안내를 표시하고, 실패 시 구체적 원인을 표시한다(UIUX §8). 업로드 버튼은 진행 중 비활성화한다. |
| FR-6-29 | 파일 업로드 시 **MIME 타입과 확장자를 모두 검증**하고, 셀 값이 `=`, `+`, `-`, `@`로 시작하면 CSV 수식 인젝션 방어를 위해 그대로 텍스트로 저장하되 **내보내기 시 앞에 `'`를 붙인다**. |
| FR-6-30 | 내보내기(Export): 현재 의도/키워드를 템플릿과 동일한 포맷의 CSV로 내려받을 수 있다(백업·타 챗봇 이관 용도). |

---

### 4.2 No.7 — 동음이의어/다의어 사전

| ID | 요구사항 |
|---|---|
| FR-7-1 | 사전 항목을 생성/조회/수정/삭제할 수 있다. 입력: `word`(필수, 1~50자), `meanings`(**2개 이상** 필수). |
| FR-7-2 | 각 의미(`meaning`)는 `label`(의미명, 1~100자), `contextHints`(문맥 힌트 단어 배열, 각 1~50자), `intentId`(선택 — 이 의미로 확정됐을 때 연결할 의도), `description`(선택)을 갖는다. |
| FR-7-3 | `word`는 `(chatbotId, 정규화 word)` 유일(FR-0-13). |
| FR-7-4 | 같은 항목 내에서 **동일한 문맥 힌트가 두 의미에 중복 등록되면 `400`**으로 거부한다(모호성 해소 사전이 스스로 모호해지는 것을 방지). |
| FR-7-5 | `intentId`는 같은 챗봇에 존재해야 한다. 없으면 `404`. 연결된 의도가 삭제 시도되면 `409`(FR-6-11). |
| FR-7-6 | 의미는 최대 10개, 의미당 문맥 힌트는 최대 30개로 제한한다. |
| FR-7-7 | **모호성 해소(disambiguation) 정책**을 항목 단위로 설정한다: `ASK`(되묻기, 기본값) / `DEFAULT_MEANING`(지정한 기본 의미로 확정) / `IGNORE`(보정하지 않음). `ASK`일 때 사용할 되묻기 문구(`clarifyPrompt`, 기본값 "어떤 ‘{word}’를 말씀하시는 건가요?")를 편집할 수 있다. |
| FR-7-8 | 되묻기는 **새 아웃풋 타입을 만들지 않고** 기존 `BUTTON` 아웃풋으로 표현한다(의미 label을 버튼으로 제시). 아웃풋 12종 enum은 변경하지 않는다. |
| FR-7-9 | 사전 항목 삭제는 다른 리소스가 이를 참조하지 않으므로 항상 허용(`204`)한다. |
| FR-7-10 | 화면은 사전 항목 목록(단어 + 의미 수 + 정책 배지)과 항목 편집 폼(의미 반복 블록: 추가/삭제/순서변경)을 제공한다. 순서 변경은 드래그가 아닌 **위/아래 버튼**으로 제공해 키보드 접근성을 보장한다(UIUX §3). |
| FR-7-11 | **테스트 입력란**을 제공해 임의 문장을 넣으면 어떤 의미로 판정되는지(또는 되묻기로 가는지) 즉시 확인할 수 있게 한다. 서버는 이 판정을 엔진의 동일 함수로 계산한다(No.10 시뮬레이터와 구현을 공유하되, 여기서는 **동음이의어 판정 결과만** 반환). |

---

### 4.3 No.9 — FAQ 관리

| ID | 요구사항 |
|---|---|
| FR-9-1 | FAQ 항목을 생성/조회/수정/삭제할 수 있다. 입력: `category`(필수, `FAQ`/`SMALL_TALK`/`SELF_SERVICE`/`ERROR_RESPONSE`), `question`(필수 1~300자), `answer`(필수 1~2000자), `altQuestions`(대체 질문 배열, 선택), `enabled`(기본 `true`), `keywordIds`(선택). |
| FR-9-2 | 목록은 `category` 필터, `q` 검색, 정렬, 페이지네이션을 지원하며 카테고리별 건수 요약(`counts`)을 함께 반환한다. |
| FR-9-3 | **대체 질문(altQuestions)**: 동일 답변을 유발하는 다른 표현을 최대 30개까지 등록할 수 있다. 매칭 시 `question`과 동등하게 취급한다. 각 1~300자. |
| FR-9-4 | **중복/유사 등록 방지(= 매뉴얼의 "자동완성")**: `question` 또는 `altQuestions` 입력 중, 정규화 기준 **동일 문장이 이미 존재하면 `409`** 로 거부한다. 동일하지 않지만 유사한 후보는 `GET .../faqs/suggest?q=`로 조회해 **경고와 함께 "기존 항목에 대체 질문으로 추가" 바로가기**를 제시한다(차단 아님). |
| FR-9-5 | 유사 후보 산출은 **규칙 기반**(정규화 후 접두 일치 > 부분 문자열 포함 > 공백 단위 토큰 자카드 유사도 ≥ 0.5)으로 한다. 임베딩 기반 의미 유사도는 No.18(Text Embedding) 범위로 제외한다. 최대 5건, 응답 200ms 이내. |
| FR-9-6 | `GET .../faqs/suggest?q=`는 **위젯의 입력 자동완성**(최종 사용자용)에도 재사용할 수 있도록 `enabled=true` 항목만, 답변 본문 없이 `{id, question}`만 반환하는 모드(`mode=public`)를 지원한다. 실제 위젯 연동은 No.11 Phase. |
| FR-9-7 | `enabled=false` 항목은 매칭 대상에서 제외되지만 목록에는 "비활성" 배지와 함께 표시된다(임시 중단 용도). |
| FR-9-8 | `ERROR_RESPONSE` 카테고리는 **미응답(fallback) 시 사용할 응답 세트**로 취급한다. 챗봇당 최소 1건을 권장하며, 0건이면 목록 상단에 안내 배너를 표시하고 엔진은 시스템 기본 문구로 폴백한다. |
| FR-9-9 | FAQ 대량 업로드/내보내기를 제공한다. 포맷 `category, question, answer, altQuestion`(4열, 대체질문은 행 반복). 검증·커밋 2단계와 오류 리포트는 FR-6-21~FR-6-29를 동일하게 적용한다. |
| FR-9-10 | FAQ 삭제는 참조 제약이 없으므로 확인 모달 후 `204`. 다건 일괄 삭제를 지원한다. |
| FR-9-11 | `answer`는 **평문 텍스트**로 저장·표시한다. HTML/마크다운 렌더링은 지원하지 않으며(XSS 표면 최소화), 줄바꿈만 보존한다. 링크가 필요하면 No.5의 `LINK` 아웃풋을 쓰도록 안내한다. |
| FR-9-12 | 답변 입력 영역은 남은 글자 수를 실시간 표시하고, 내용 초과 시 세로 스크롤을 제공한다(UIUX §5). |

---

### 4.4 No.8 — 컨텍스트(멀티턴·슬롯필링) 관리

#### 4.4.1 컨텍스트(폼) 정의

| ID | 요구사항 |
|---|---|
| FR-8-1 | 컨텍스트를 생성/조회/수정/삭제할 수 있다. 입력: `name`(필수, 유일), `description`(선택), `slots`(**1개 이상**), `completionMessage`(선택), `cancelKeywords`(선택, 기본 `["취소", "그만", "처음으로"]`), `sessionTimeoutMinutes`(기본 30, 1~180). |
| FR-8-2 | 슬롯은 `name`(영문/숫자/언더스코어, 1~50자, 폼 내 유일), `label`(표시명), `prompt`(질문 문구, 1~200자, 필수), `type`(`TEXT`/`NUMBER`/`DATE`/`PHONE`/`EMAIL`/`CHOICE`/`KEYWORD`), `required`(기본 true), `choices`(CHOICE일 때 필수, 2~20개), `keywordId`(KEYWORD일 때 필수 — No.6 키워드 사전으로 값 검증), `validation`(NUMBER: min/max, TEXT: 정규식·최대길이, DATE: 포맷), `errorPrompt`(재질문 문구), `maxRetry`(기본 2, 0~5), `exampleValue`(선택)를 갖는다. |
| FR-8-3 | 슬롯 수집 순서는 배열 순서를 따른다. 화면에서 **위/아래 버튼으로 순서 변경**(드래그 금지, UIUX §3)할 수 있다. |
| FR-8-4 | 슬롯은 폼당 최대 **20개**로 제한한다. |
| FR-8-5 | `type=KEYWORD`의 `keywordId`가 유효하지 않으면 `404`. 해당 키워드가 삭제 시도되면 `409`(FR-6-18을 컨텍스트 참조까지 확장). |
| FR-8-6 | 컨텍스트 삭제 시 이를 참조하는 `DialogNode`(`contextVariableId` 또는 `CONTEXT_FORM` 아웃풋)가 있으면 `409`. |
| FR-8-7 | 폼 편집 화면은 **슬롯 미리보기(대화 형태)** 를 제공해 질문 순서와 문구를 저장 전에 확인하게 한다(서버 왕복 없이 클라이언트 렌더링). |

#### 4.4.2 세션 상태(멀티턴 실행 규격)

| ID | 요구사항 |
|---|---|
| FR-8-8 | 세션 상태 스키마 `ContextSessionState`를 정의한다: `contextVariableId`, `currentSlotIndex`, `filledValues: Record<string, string>`, `retryCount`, `startedAt`, `lastInteractedAt`, `status`(`IN_PROGRESS`/`COMPLETED`/`CANCELLED`/`EXPIRED`). |
| FR-8-9 | 상태 전이는 **순수 함수**(`advanceContextSession(state, input, definition) → { nextState, outputs }`)로 구현한다. DB·시간 의존을 배제하기 위해 현재 시각은 인자로 주입한다. |
| FR-8-10 | 슬롯 값 검증 실패 시 `retryCount`를 1 증가시키고 `errorPrompt`(없으면 기본 문구 + 예시값)를 재출력한다. `maxRetry` 초과 시 폼을 `CANCELLED`로 종료하고 이탈 안내 + `ERROR_RESPONSE` FAQ 또는 fallback 노드로 넘긴다. |
| FR-8-11 | 사용자가 `cancelKeywords` 중 하나를 입력하면 즉시 `CANCELLED`로 종료하고 "요청을 취소했어요"를 출력한다. 이 판정은 슬롯 값 검증보다 **우선**한다. |
| FR-8-12 | `lastInteractedAt` 기준 `sessionTimeoutMinutes` 경과 후 입력이 오면 `EXPIRED`로 처리하고, 이어서 하기/처음부터 다시 시작 중 선택하도록 `BUTTON` 아웃풋으로 안내한다. 기본 동작은 **새로 시작**이다. |
| FR-8-13 | 모든 필수 슬롯이 채워지면 `COMPLETED`로 전이하고, `completionMessage`(치환자 `{슬롯명}` 지원)를 출력한 뒤 노드에 지정된 후속 아웃풋으로 넘긴다. |
| FR-8-14 | 선택(`required=false`) 슬롯은 "건너뛰기" 입력(또는 버튼)으로 통과할 수 있으며 `filledValues`에 값이 기록되지 않는다. |
| FR-8-15 | 세션 상태의 **영속화(테이블/Redis)와 만료 정리 배치는 이번 Phase 범위 밖**이다. 이번에는 상태를 입출력으로 주고받는 stateless 계약만 확정하고, No.10 시뮬레이터는 메모리(요청-응답 왕복)로 상태를 유지한다(§9). |
| FR-8-16 | `filledValues`에 담기는 값은 전화번호·이메일 등 PII일 수 있다. 로깅 시 마스킹 대상임을 스키마 주석으로 표시하고, 실제 마스킹은 대화로그 저장 경로(대화처리 Phase)의 책임으로 둔다. |

---

### 4.5 No.5 — 대화 그래프(시나리오) 빌더

#### 4.5.1 범위 결정 — 1차는 리스트/폼 기반 (결론)

**결정: 1차 범위는 리스트/폼 기반 CRUD + 읽기전용 "흐름 요약 뷰"로 한다. 드래그앤드롭 비주얼 캔버스는 Out of scope(§9.2)로 명시한다.** 근거는 다음과 같다.

1. **접근성 기준과 충돌한다(가장 결정적)**. `UIUX_준수기준.md` §3은 "모든 대화형 요소는 Tab 순차 진입, 마우스 클릭과 키보드 Enter/Space 두 방식 모두 동일 동작"을 요구한다. 드래그앤드롭 캔버스는 키보드 대체 경로를 별도로 전부 구현해야 하며, 사실상 **폼 기반 UI를 캔버스와 함께 2벌 만들어야** 기준을 충족한다. 폼 기반을 먼저 완성하는 것이 순서상 맞다.
2. **데이터 모델에 엣지(연결선) 개념이 아직 없다**. 현재 `DialogNode`에는 `nextNodeId` 같은 연결 필드가 없고, 노드 이동은 `DIALOG_MOVE` 아웃풋의 payload로만 표현된다. 캔버스는 "명시적 엣지 + 좌표(x,y)" 모델을 전제로 하는데, 이를 먼저 확정하지 않고 캔버스를 만들면 재작업이 확정적이다.
3. **핵심 리스크는 UI가 아니라 실행기다**(§1.3). 캔버스가 있어도 실행기가 없으면 노드는 죽은 데이터다. 한정된 Phase 예산은 §4.6 실행기에 배정하는 편이 기능 완성도에 기여한다.
4. 대신 **흐름 파악 수단을 최소 비용으로 제공**한다 — 노드 목록에 "이 노드로 들어오는 조건 / 이 노드가 이동시키는 대상"을 표시하고, 읽기전용 트리/리스트 형태의 `흐름 미리보기`와 `설계 점검`(FR-5-16)으로 오설계를 잡는다.

> 후속 Phase에서 캔버스를 도입할 때를 대비해 **좌표 필드(`canvasX`, `canvasY`)를 지금 스키마에 nullable로 추가할 것**을 권고한다(§5.2 DD-2). 데이터는 지금 쌓아두고 UI만 나중에 붙일 수 있게 한다.

#### 4.5.2 노드 CRUD

| ID | 요구사항 |
|---|---|
| FR-5-1 | 대화 노드를 생성/조회/수정/삭제할 수 있다. 입력: `name`(필수, 유일), `description`(선택), `nodeType`(`NORMAL`/`START`/`FALLBACK`, 기본 `NORMAL`), `enabled`(기본 true), `priority`(정수, 기본 100), `matchMode`(`ANY`/`ALL`, 기본 `ANY`), `intentIds`, `keywordIds`, `contextVariableId`, `outputs`. |
| FR-5-2 | 인풋 조건은 **의도·키워드·컨텍스트의 조합**이다. `matchMode=ANY`는 조건 중 하나라도 충족하면 매칭, `ALL`은 지정한 모든 종류의 조건을 충족해야 매칭한다(같은 종류 내부는 항상 OR). |
| FR-5-3 | 인풋 조건이 **하나도 없는 노드는 `NORMAL` 타입으로 저장 불가**(`400`)다. 조건 없는 노드는 `START` 또는 `FALLBACK`으로만 허용한다. |
| FR-5-4 | 챗봇당 `START` 노드는 **최대 1개**, `FALLBACK` 노드는 **최대 1개**다. 이미 존재하는데 추가 지정하면 `409`. |
| FR-5-5 | `intentIds`/`keywordIds`/`contextVariableId`는 **같은 챗봇에 실제로 존재해야** 한다. 유효하지 않으면 `404`(어느 ID가 문제인지 `details`로 특정). |
| FR-5-6 | `outputs`는 **1개 이상**이어야 저장할 수 있다. 다만 작성 중 임시 저장을 위해 `enabled=false`인 노드는 빈 아웃풋을 허용하고, 설계 점검(FR-5-16)에서 경고로 표시한다. |
| FR-5-7 | 노드 1건의 아웃풋은 최대 **10개**다. 아웃풋 순서는 배열 순서이며 위/아래 버튼으로 변경한다(드래그 금지). |
| FR-5-8 | `priority`가 큰 노드가 먼저 평가된다. 동일 `priority`면 **조건이 더 구체적인 노드**(조건 개수 많음 → `ALL` → `updatedAt` 최신) 순으로 평가한다. 이 규칙은 엔진과 화면 설명 문구가 동일해야 한다. |
| FR-5-9 | 노드를 복사할 수 있다(`{원본명} (사본)`, `enabled=false`로 생성). 인풋 조건까지 복사되므로 중복 조건 경고(FR-5-17)가 함께 표시된다. |
| FR-5-10 | 노드 삭제 시 이 노드를 `DIALOG_MOVE` 대상으로 참조하는 다른 노드가 있으면 `409`(FR-0-10). |
| FR-5-11 | 노드 목록은 `name`, `nodeType` 배지, `enabled`, `priority`, 조건 요약(의도/키워드/컨텍스트 이름 칩), `outputs` 타입 요약(아이콘+텍스트), `updatedAt`, 들어오는 참조 수(`incomingCount`)를 보여준다. |

#### 4.5.3 아웃풋 12종

| ID | 요구사항 |
|---|---|
| FR-5-12 | 아웃풋 타입 enum은 기존 12종(`DialogOutputType`)을 **그대로 유지**한다. 이번 Phase에서 타입을 추가하지 않는다. |
| FR-5-13 | `payload`는 현재 자유 JSON(`z.record(z.unknown())`)이나, **타입별 판별 유니온(discriminated union)으로 세분화**한다. 저장 시 타입별 필수 필드를 서버에서 검증해 잘못된 노드가 런타임에 터지지 않게 한다(FR-0-16). |
| FR-5-14 | 타입별 payload 규격과 이번 Phase의 처리 수준: <br>① `TEXT` `{text:1~1000자}` — 정의·실행 <br>② `CARD` `{title, description?, imageUrl?, buttons?[]}` — 정의·실행 <br>③ `IMAGE` `{imageUrl(SafeUrl), altText(필수)}` — 정의·실행(대체 텍스트 필수, 접근성) <br>④ `BUTTON` `{text?, buttons: [{label, action: MESSAGE|LINK|NODE, value}] 1~5개}` — 정의·실행 <br>⑤ `LINK` `{label, url(SafeUrl), openInNewTab?}` — 정의·실행 <br>⑥ `PAUSE` `{durationMs: 100~5000}` — 정의·실행 <br>⑦ `PHONE_CALL` `{label, phoneNumber}` — 정의·실행(`tel:` 링크 생성, 형식 검증) <br>⑧ `CONTEXT_FORM` `{contextVariableId}` — 정의·실행(No.8 세션 시작) <br>⑨ `DIALOG_MOVE` `{targetNodeId}` — 정의·실행(순환 검사 대상) <br>⑩ `SCENARIO` `{scenarioKey, params?}` — **정의·저장·검증만**, 실행은 No.26(레거시 API 연동) <br>⑪ `SURVEY` `{surveyId}` — **정의·저장·검증만**, 실행은 No.27(설문관리) <br>⑫ `API_CONDITION` `{method, url, headers?, bodyTemplate?, conditions:[{path, operator, value, nextNodeId}]}` — **정의·저장·검증만**, 실행은 No.26 |
| FR-5-15 | ⑩⑪⑫ 3종은 편집 화면에서 "저장은 되지만 이번 버전에서는 실행되지 않습니다(예정: No.26/27)"라는 **명시적 안내 배지**를 표시한다. 엔진은 이 타입을 만나면 실행을 건너뛰고 `unsupportedOutputs`에 기록해 시뮬레이터가 알려줄 수 있게 한다. |

#### 4.5.4 설계 점검(Validation) 및 흐름 요약

| ID | 요구사항 |
|---|---|
| FR-5-16 | **설계 점검** 기능을 제공한다(`POST .../dialog-nodes/validate`). 검출 항목: ① 아웃풋이 빈 노드 ② 존재하지 않는 의도/키워드/컨텍스트/노드 ID 참조(끊어진 참조) ③ **순환 이동 경로**(무조건 `DIALOG_MOVE` 체인의 사이클) ④ 중복 조건 노드 ⑤ 어떤 조건에도 걸리지 않는 고아 노드(들어오는 참조 0 + 인풋 조건 0) ⑥ `FALLBACK` 노드 부재 ⑦ 예문이 0개인 의도를 조건으로 쓰는 노드 ⑧ 실행 미지원 아웃풋(⑩⑪⑫) 사용. |
| FR-5-17 | 각 검출 항목은 `severity`(`ERROR`/`WARNING`/`INFO`)와 대상 리소스 ID·이름·수정 화면 링크를 포함한다. `ERROR`가 있어도 **저장 자체를 막지는 않되**, 챗봇 상태를 `ACTIVE`로 전환할 때 경고를 표시한다(상태 전환 차단은 No.1 규칙을 바꾸지 않으므로 하지 않는다). |
| FR-5-18 | **순환 검사 규칙**: `DIALOG_MOVE` 아웃풋만으로 이루어진 이동 그래프에서 DFS로 사이클을 찾는다. 사이클은 `WARNING`(조건부 분기로 탈출 가능할 수 있으므로 `ERROR` 아님)이며, 런타임에는 **한 요청당 노드 이동 최대 10회(hop limit)** 로 강제 종료하고 안내 문구를 출력한다. |
| FR-5-19 | **흐름 미리보기**: 노드 목록 옆에 읽기전용 계층 뷰를 제공한다. `START`(없으면 priority 최상위) 노드를 루트로 두고 `DIALOG_MOVE`/버튼의 `NODE` 액션을 따라 트리로 펼치며, 이미 방문한 노드는 "↩ 반복" 표시로 접는다. 순수 텍스트·리스트 기반이며 키보드로 펼침/접기가 가능해야 한다. |
| FR-5-20 | 노드 편집 화면은 인풋 조건 선택 시 **의도/키워드/컨텍스트를 검색 가능한 목록에서 고르게** 한다(ID 직접 입력 금지). 목록에 없으면 해당 화면으로 이동하는 바로가기를 제공한다. |

---

### 4.6 매칭 엔진 통합 (FR-E) — 이 그룹의 필수 산출물

> §1.3의 공백을 메우는 요구사항이다. 구현 위치는 `packages/dialogue-engine`이며, **DB·NestJS 무의존 순수 함수**로 작성해 단위 테스트를 1차 타깃으로 삼는다(`개발명세서.md` §2.1 `lib/*` 규약과 동일 철학).

| ID | 요구사항 |
|---|---|
| FR-E-1 | 엔진 입력 번들 `DialogueBundle`을 정의한다: `{ intents, keywords, homonyms, dialogNodes, contexts, faqs }`. API 서버는 챗봇 1건의 대화 자산을 이 형태로 조립해 엔진에 넘긴다. |
| FR-E-2 | 진입점 `resolveResponse(input, session, bundle, now) → DialogueResolution`을 추가한다. 반환: `{ matchedNodeId?, matchedIntentId?, matchedFaqId?, homonymResolution?, outputs: DialogOutput[], nextSession: ContextSessionState \| null, unsupportedOutputs: DialogOutputType[], trace: TraceStep[] }`. |
| FR-E-3 | **해석 우선순위**를 다음으로 고정한다. <br>① 진행 중 컨텍스트 세션이 있으면 취소어 → 만료 → 슬롯 값 검증 순으로 처리(FR-8-10~12) <br>② 동음이의어 보정(전처리): 확정된 의미의 `intentId`를 후보에 가산, `ASK` 정책이고 모호하면 즉시 되묻기 아웃풋 반환 <br>③ `DialogNode` 매칭(`enabled=true`만, `priority` 내림차순, FR-5-8 타이브레이크) → outputs 반환 <br>④ FAQ 매칭(`enabled=true`, `question` + `altQuestions`) <br>⑤ 의도만 매칭되고 연결 노드가 없을 때 → 의도 단독 fallback(현행 `matchIntent` 동작 유지) <br>⑥ `FALLBACK` 노드 → `ERROR_RESPONSE` FAQ → 시스템 기본 문구 |
| FR-E-4 | **기존 `simulate(input, intents, faqs)`의 시그니처는 하위호환을 위해 유지**하고 내부에서 `resolveResponse`에 위임하도록 리팩터링한다(기존 테스트가 깨지지 않아야 한다). 단, 현행 `simulate`는 FAQ를 의도보다 먼저 보므로, **노드 우선 규칙(FR-E-3 ③ > ④)** 도입으로 동작이 달라지는 지점을 테스트로 명시한다. |
| FR-E-5 | `DIALOG_MOVE` 실행: 대상 노드의 outputs를 이어붙이며, 한 요청당 최대 10회 이동(FR-5-18). 초과 시 이동을 중단하고 `trace`에 `HOP_LIMIT_EXCEEDED`를 남긴다. |
| FR-E-6 | `CONTEXT_FORM` 실행: 해당 컨텍스트의 첫 슬롯 `prompt`를 출력하고 `nextSession`을 `IN_PROGRESS`로 반환한다. |
| FR-E-7 | 실행 미지원 타입(`SCENARIO`/`SURVEY`/`API_CONDITION`)은 출력에서 제외하고 `unsupportedOutputs`에 담는다(FR-5-15). 예외를 던지지 않는다. **[갱신 No.26·No.27]** 미지원 대상은 이제 `SCENARIO` · v1(이전 형식) `API_CONDITION` · v1(이전 형식) `SURVEY`뿐이다 — 판정은 타입이 아니라 형태(`isUnsupportedOutput()`) |
| FR-E-8 | `trace`(단계별 판정 근거: 평가한 노드·점수·탈락 사유)를 항상 생성한다. No.10 시뮬레이터가 "왜 이 응답이 나왔는지"를 보여주는 데 쓰며, 이번 Phase에서는 API 응답 스키마로만 정의한다. |
| FR-E-9 | 엔진은 **손상된 데이터에 대해 예외를 던지지 않는다**. 끊어진 참조 ID, 파싱 실패 JSON, 빈 배열은 무시하고 `trace`에 경고를 남긴다(가용성 우선). 데이터 품질은 FR-0-16/FR-5-16이 책임진다. |
| FR-E-10 | 성능: 의도 1,000건·예문 20,000건·노드 500건·FAQ 2,000건 기준 `resolveResponse` **P95 200ms 이내**(`개발명세서.md` §5). 매 호출마다 전체 예문을 선형 스캔하는 현행 방식이 이 기준을 넘기면 정규화 결과 **사전 인덱싱(예문→의도 Map)** 을 도입한다. |
| FR-E-11 | 엔진 단위 테스트는 FR-E-3의 6단계 우선순위 각각과 §8 예외 케이스를 커버한다. |

---

## 5. 데이터 요구사항

### 5.1 기존 자산 (재사용)

| 스키마/모델 | 위치 | 이번 Phase에서의 처리 |
|---|---|---|
| `IntentSchema`, `KeywordSchema` | `shared-types/src/dialogue.ts` | 필드 보강(§5.2) |
| `HomonymDictionarySchema`, `HomonymMeaningSchema` | 동일 | 의미 구조 보강(FR-7-2) |
| `DialogOutputType`(12종), `DialogOutputSchema` | 동일 | enum 유지, payload를 판별 유니온으로 세분화(FR-5-13) |
| `DialogNodeSchema` | 동일 | 필드 보강(§5.2) |
| `ContextSlotSchema`, `ContextVariableSchema` | 동일 | 슬롯 속성 대폭 보강(FR-8-2) |
| `FaqCategory`, `FaqEntrySchema` | 동일 | `altQuestions`/`enabled`/`updatedAt` 보강 |
| `SimulateResultSchema` | 동일 | `DialogueResolution`으로 확장(하위호환 유지, FR-E-4) |
| `PaginationQuerySchema`, `paginated()`, `ApiErrorCode`, `SafeUrlSchema`, `csvEnumArray()` | `shared-types/src/common.ts` | 그대로 사용. `ApiErrorCode`에 값 추가 필요(§5.3) |
| `matchIntent`, `matchFaq`, `simulate` | `packages/dialogue-engine` | 유지 + `resolveResponse` 추가(FR-E) |
| Prisma `Intent`/`Keyword`/`HomonymDictionary`/`DialogNode`/`ContextVariable`/`FaqEntry` | `apps/api/prisma/schema.prisma` | 필드 추가(§5.2) — `onDelete: Restrict` 정책은 **변경하지 않음** |

### 5.2 데이터 모델 변경 제안 (system-architect 판단 필요)

| ID | 대상 | 제안 | 근거 |
|---|---|---|---|
| **DD-1** | `Intent`, `Keyword`, `ContextVariable`, `HomonymDictionary` | `description String?` 추가. `HomonymDictionary`·`ContextVariable`에 **`updatedAt DateTime @updatedAt` 추가**(현재 없어 수정 기능과 정렬 규약 FR-0-14를 만족할 수 없음) | FR-0-14, FR-7-1, FR-8-1 |
| **DD-2** | `DialogNode` | `priority Int @default(100)`, `enabled Boolean @default(true)`, `nodeType String @default("NORMAL")`, `matchMode String @default("ANY")`, `description String?`, **`canvasX Float?`, `canvasY Float?`**(후속 캔버스 대비, 지금은 미사용) 추가 | FR-5-1, §4.5.1 |
| **DD-3** | `FaqEntry` | `altQuestions String @default("[]")`(JSON), `enabled Boolean @default(true)`, `keywordIds String @default("[]")` 추가 | FR-9-1, FR-9-3, FR-9-7 |
| **DD-4** | 유일성 제약 | `@@unique([chatbotId, name])` — `Intent`, `Keyword`, `ContextVariable`, `DialogNode` / `@@unique([chatbotId, word])` — `HomonymDictionary`. **단 정규화(소문자·공백 축약) 기준 유일성은 DB 제약으로 표현할 수 없으므로**, DB에 `nameNormalized` 컬럼을 두고 유니크를 거는 방안(A) vs 서비스 계층 사전 검사만 쓰는 방안(B)을 아키텍트가 결정한다. **A안 권장**(동시 요청 경합에서도 안전) | FR-0-13 |
| **DD-5** | 역참조 성능 | `DialogNode.intentIds`/`keywordIds`가 JSON 문자열이라 "이 의도를 참조하는 노드" 조회가 **전체 스캔 + 문자열 LIKE**가 된다. 삭제 사전 검사(FR-6-11)와 `linkedNodeCount`(FR-6-8)가 목록 조회마다 호출되므로 성능·정확도(부분 문자열 오탐) 문제가 있다. **조인 테이블 `DialogNodeIntent(nodeId, intentId)`, `DialogNodeKeyword(nodeId, keywordId)` 도입을 권장**한다. 도입 시 JSON 필드는 파생 캐시로 남기거나 제거한다. | FR-6-8, FR-6-11, NFR-P2 |
| **DD-6** | `DialogNode.contextVariableId` | 현재 단순 `String?`으로 FK가 아니다. FK 관계(`onDelete: Restrict`)로 승격하면 DB가 참조 무결성을 보장한다. 단 `CONTEXT_FORM` 아웃풋 payload 안의 참조는 여전히 앱 레벨 검사가 필요하다 | FR-5-5, FR-8-6 |
| **DD-7** | 대량 업로드 임시 저장 | `importToken`(FR-6-21)의 dry-run 결과 보관 위치 — ① 서버 메모리(단순, 다중 인스턴스에서 실패) ② 임시 테이블 `ImportBatch` ③ 재검증(토큰 없이 커밋 시 파일 재업로드). **②를 권장**하되 단일 인스턴스 전제면 ①도 허용 | FR-6-21 |
| **DD-8** | 엑셀 파싱 의존성 | `.xlsx` 파싱 라이브러리(`exceljs`/`xlsx`) 신규 도입이 필요하다. 보안 이슈(취약 버전)·번들 크기를 고려해 **서버 전용 의존성**으로만 추가하고, 1차에서 CSV만 지원하고 xlsx를 후속으로 미루는 축소안도 검토 대상 | FR-6-20 |
| **DD-9** | 인덱스 | `intents(chatbotId, updatedAt)`, `keywords(chatbotId, updatedAt)`, `dialog_nodes(chatbotId, priority)`, `faq_entries(chatbotId, category)` 추가 | NFR-P1 |
| **DD-10** | 세션 영속화 | `ContextSessionState`는 이번 Phase에서 **테이블을 만들지 않는다**(FR-8-15). 후속 Phase에서 `ConversationSession` 테이블 또는 Redis로 결정 | §9 |

### 5.3 `shared-types` 신규/확장 스키마

| 스키마 | 내용 | 근거 |
|---|---|---|
| `IntentSchema` 확장 | `description?`, `exampleCount`, `linkedNodeCount`(목록 응답용 별도 `IntentListItemSchema` 권장) | FR-6-8 |
| `CreateIntentSchema` / `UpdateIntentSchema` | 생성·부분수정 입력 | FR-6-1, FR-6-10 |
| `IntentExampleMutationSchema` | `{ add?: string[], remove?: string[] }` 단건 예문 편집 | FR-6-10 |
| `CreateKeywordSchema` / `UpdateKeywordSchema` | 동일 패턴 | FR-6-14 |
| `HomonymMeaningSchema` 확장 | `label`, `contextHints[]`, `intentId?`, `description?` (현행 `meaning`/`contextHint` 단수 구조 대체) | FR-7-2 |
| `HomonymPolicy` enum | `ASK`/`DEFAULT_MEANING`/`IGNORE` + `clarifyPrompt` | FR-7-7 |
| `ContextSlotSchema` 확장 | `label`, `type`, `required`, `choices?`, `keywordId?`, `validation?`, `errorPrompt?`, `maxRetry` | FR-8-2 |
| `ContextSlotType` enum | `TEXT｜NUMBER｜DATE｜PHONE｜EMAIL｜CHOICE｜KEYWORD` | FR-8-2 |
| `ContextSessionStateSchema`, `ContextSessionStatus` | 멀티턴 세션 상태 | FR-8-8 |
| `DialogNodeType`, `DialogMatchMode` enum | `NORMAL｜START｜FALLBACK`, `ANY｜ALL` | FR-5-1 |
| `DialogOutputSchema` 판별 유니온 | 12종 타입별 payload 스키마(`TextOutputPayloadSchema` 등) | FR-5-13, FR-5-14 |
| `FaqEntrySchema` 확장 + `FaqSuggestionSchema` | `altQuestions`, `enabled`, `keywordIds`, 유사 후보 응답 | FR-9-1, FR-9-4 |
| `ImportValidateResultSchema`, `ImportCommitRequestSchema`, `ImportRowErrorSchema`, `ImportMergePolicy`, `ImportErrorPolicy` | 대량 업로드 2단계 계약 | FR-6-21~26 |
| `DesignValidationReportSchema`, `DesignIssueSchema`, `DesignIssueSeverity` | 설계 점검 결과 | FR-5-16 |
| `DialogueBundleSchema`, `DialogueResolutionSchema`, `TraceStepSchema` | 엔진 입출력 계약 | FR-E-1, FR-E-2 |
| `ApiErrorCode` 추가 값 | `DUPLICATE_NAME`, `INTENT_IN_USE`, `KEYWORD_IN_USE`, `CONTEXT_IN_USE`, `NODE_IN_USE`, `SYNONYM_CONFLICT`, `DUPLICATE_FAQ`, `INVALID_REFERENCE`, `IMPORT_TOO_LARGE`, `IMPORT_TOKEN_EXPIRED`, `OUTPUT_PAYLOAD_INVALID`, `START_NODE_EXISTS`, `FALLBACK_NODE_EXISTS` | FR-0-10, §8 |

### 5.4 API 엔드포인트 개요

모든 경로 앞에 `/api/v1/chatbots/:chatbotId`가 붙는다(FR-0-9).

| 메서드 | 경로 | 기능 | 주요 응답 |
|---|---|---|---|
| GET/POST | `/intents` | 의도 목록·생성 | 200 / 201 / 400 / 409 |
| GET/PATCH/DELETE | `/intents/:id` | 의도 단건·수정·삭제 | 200 / 204 / 404 / 409 |
| PATCH | `/intents/:id/examples` | 예문 추가/삭제 | 200 / 400 |
| POST | `/intents/bulk-delete` | 일괄 삭제(원자적) | 204 / 409 |
| POST | `/intents/import/validate` · `/intents/import/commit` | 대량 업로드 2단계 | 200 / 400 |
| GET | `/intents/import/template` · `/intents/export` | 템플릿·내보내기(CSV) | 200 |
| GET/POST/PATCH/DELETE | `/keywords`, `/keywords/:id` | 키워드 CRUD | 동일 패턴 |
| POST/GET | `/keywords/import/*`, `/keywords/export` | 대량 업로드·내보내기 | 동일 패턴 |
| GET/POST/PATCH/DELETE | `/homonyms`, `/homonyms/:id` | 동음이의어 사전 CRUD | 200 / 201 / 204 / 400 / 404 / 409 |
| POST | `/homonyms/test` | 문장 판정 테스트 | 200 |
| GET/POST/PATCH/DELETE | `/contexts`, `/contexts/:id` | 컨텍스트(폼) CRUD | 동일 패턴 |
| GET/POST/PATCH/DELETE | `/dialog-nodes`, `/dialog-nodes/:id` | 대화 노드 CRUD | 동일 패턴 |
| POST | `/dialog-nodes/:id/copy` | 노드 복사 | 201 / 404 |
| POST | `/dialog-nodes/validate` | 설계 점검 | 200 |
| GET | `/dialog-nodes/flow` | 흐름 요약(읽기전용 트리) | 200 |
| GET/POST/PATCH/DELETE | `/faqs`, `/faqs/:id` | FAQ CRUD | 동일 패턴 |
| GET | `/faqs/suggest?q=&mode=` | 유사/자동완성 후보 | 200 |
| POST | `/faqs/bulk-delete`, `/faqs/import/*` | 일괄 삭제·대량 업로드 | 204 / 200 |

> `개발명세서.md` §4는 현재 `/entities`로 표기되어 있으나 Prisma 모델·모듈명이 `Keyword`/`keywords`이므로 **`/keywords`로 통일**할 것을 제안한다(§10).

---

## 6. 비기능 요구사항

### 6.1 성능

| ID | 요구사항 |
|---|---|
| NFR-P1 | 의도/키워드/FAQ/노드 목록 조회 P95 **300ms** 이내(의도 1,000건, FAQ 2,000건, 노드 500건 기준). `linkedNodeCount` 계산이 N+1 쿼리가 되지 않게 한다(DD-5). |
| NFR-P2 | 삭제 전 참조 검사 P95 **200ms** 이내. |
| NFR-P3 | 엔진 `resolveResponse` P95 **200ms** 이내(FR-E-10 규모 기준). |
| NFR-P4 | FAQ 유사 후보 조회 P95 **200ms**, 입력 디바운스 400ms. |
| NFR-P5 | 5,000행 대량 업로드 검증(dry-run) **10초** 이내, 커밋 **20초** 이내. 초과 예상 시 진행 안내를 유지하고 타임아웃은 `504` 대신 명시적 오류 코드로 반환한다. |
| NFR-P6 | 대량 업로드 커밋은 행 단위 개별 INSERT가 아니라 **배치 처리**한다(SQLite 트랜잭션 1회). |

### 6.2 보안

| ID | 요구사항 |
|---|---|
| NFR-S1 | 모든 입력은 서버에서 zod로 재검증한다(프런트 검증 불신). |
| NFR-S2 | 예문/답변/문구 등 사용자 입력은 화면 렌더링 시 이스케이프한다. FAQ 답변은 평문 전용(FR-9-11)으로 HTML 렌더링을 하지 않는다. |
| NFR-S3 | `IMAGE.imageUrl`, `LINK.url`, `CARD.imageUrl`, `API_CONDITION.url`은 `SafeUrlSchema`(http/https만)를 사용한다. |
| NFR-S4 | `API_CONDITION`의 `url`은 저장만 하더라도 **SSRF 위험**이 있으므로, 실행 Phase(No.26)에서 사설 IP 대역(`127.0.0.0/8`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16`) 차단이 필요함을 스키마 주석과 설계서에 명시한다. 이번 Phase에는 저장 시 형식 검증까지만 한다. **[해소 2026-09-24 No.26]** 인라인 URL은 v2에서 폐기되고(노드는 등록된 연결 id + 상대 경로만), SSRF 방어는 "사설 대역 차단"이 아니라 **다층 방어**(DNS 후 주소 검사·주소 고정 · 루프백/링크로컬/메타데이터 절대 차단 · 사설 대역은 운영자 allowlist로만 · 리다이렉트 불추종 · 응답 상한)로 재정의됐다 — `legacy-api-integration-설계.md` §7, ADR-0034 §4 |
| NFR-S5 | `API_CONDITION.headers`에 담기는 인증 토큰은 평문 저장 대상이다. 이번 Phase는 **저장 자체를 허용하되** 화면에서 마스킹 표시하고, 암호화 저장은 No.26/No.45(데이터 거버넌스) 과제로 기록한다. **[해소 2026-09-24 No.26]** 암호화가 아니라 **노드에서 시크릿을 제거**했다 — v2에는 헤더 필드가 없고 시크릿은 연결의 `secretRef` → 서버 환경변수로만 주입된다. 기존 v1의 평문 헤더 값은 노드·버전 조회 응답에서 가리며(`[비공개]`), v1은 새로 저장할 수 없다(ADR-0034 §3·§7) |
| NFR-S6 | 업로드 파일은 확장자·MIME·크기·행수를 검증하고, 압축 폭탄 방지를 위해 스트리밍 파싱 또는 행 수 상한을 적용한다. 파일은 파싱 후 즉시 폐기하고 디스크에 남기지 않는다. |
| NFR-S7 | CSV 내보내기 시 수식 인젝션 방어(FR-6-29). |
| NFR-S8 | `@RequirePermission('dialogue:read'｜'dialogue:write')` 데코레이터를 지금부터 부착한다(가드는 No.12까지 no-op). |
| NFR-S9 | 슬롯 값(`filledValues`)은 PII 가능성이 있으므로 서버 로그에 원문을 남기지 않는다(FR-8-16). |
| NFR-S10 | 교차 챗봇 참조 시도는 `403`이 아닌 `404`로 응답해 타 챗봇 리소스 존재 여부를 노출하지 않는다(FR-0-9). |

### 6.3 접근성/UI 품질 (`UIUX_준수기준.md`)

| ID | 요구사항 |
|---|---|
| NFR-A1 | 노드·슬롯·아웃풋·의미의 **순서 변경은 위/아래 버튼**으로 제공하고, 드래그앤드롭을 유일한 수단으로 두지 않는다(§3). |
| NFR-A2 | 모든 편집 폼은 레이블을 제공하고(플레이스홀더 대체 금지), 길이 제한 필드는 남은 글자 수를 실시간 표시한다(§5). |
| NFR-A3 | 아웃풋 타입·노드 타입·FAQ 카테고리·설계 점검 심각도는 **색상 + 텍스트(아이콘) 병기**로 구분한다(§1). |
| NFR-A4 | 대량 업로드 결과·설계 점검 결과는 표 형태로 제공하고 키보드로 탐색 가능해야 하며, 각 항목에서 해당 편집 화면으로 이동하는 링크는 `href` 기반이다(§9). |
| NFR-A5 | 조회/업로드/검증 중 스켈레톤·스피너로 진행 상태를 명시하고 완료 시 결과 건수 배지를 표시한다(§8). |
| NFR-A6 | 오류는 제출 시점에 필드 하단 인라인으로 원인+해결방법을 함께 표시한다(§7). 대량 업로드는 행 번호를 포함한다. |
| NFR-A7 | `IMAGE`/`CARD` 아웃풋의 이미지에는 **대체 텍스트 입력을 필수**로 한다(FR-5-14 ③). |
| NFR-A8 | 노드·의도가 0건인 초기 상태에는 빈 상태 안내와 다음 행동(템플릿 다운로드/의도 먼저 만들기)을 제시한다. |
| NFR-A9 | 편집 중 이탈 시 "저장하지 않은 변경 사항" 확인을 표시한다(기존 `UnsavedGuardContext` 재사용). |

### 6.4 유지보수/테스트 용이성

| ID | 요구사항 |
|---|---|
| NFR-M1 | 매칭·정규화·세션 전이·설계 점검 로직은 **전부 `packages/dialogue-engine` 또는 `apps/api/src/**/lib/*.ts`의 순수 함수**로 두고 DB 없이 단위 테스트한다. |
| NFR-M2 | 텍스트 정규화 규칙은 단일 소스(FR-0-12)를 유지하고 API/엔진/프런트가 공유한다. |
| NFR-M3 | 4계층 규약(`controller`/`service`/`mapper`/`lib`)을 6개 모듈에 동일하게 적용한다(`개발명세서.md` §2.1). JSON 문자열 ↔ 객체 변환은 **전부 mapper에서만** 수행한다. |
| NFR-M4 | JSON 파싱 실패 시 기본값 폴백 + 경고 로그(§3.1 데이터 규약). 화면이 깨지지 않아야 한다. |
| NFR-M5 | seed에 이 그룹의 샘플 데이터를 추가한다 — 의도 5건(예문 포함)/키워드 3건/동음이의어 1건/컨텍스트 1건(커피주문)/노드 4건(START·NORMAL 2·FALLBACK)/FAQ 4종 카테고리 각 1건 이상, 그리고 **대화 자산이 0건인 챗봇 1개**(빈 상태 AC 검증용). |
| NFR-M6 | DB 이식성: 원시 SQL 사용을 피하고, 불가피하면 서비스 파일 1곳으로 격리한다(`개발명세서.md` §5). |

---

## 7. 수용기준 (Acceptance Criteria)

### AC-6. 의도·키워드 관리 (No.6)

- **AC-6-1** Given 챗봇이 존재, When `name: "주문_배송조회"`, `examples: ["배송 조회","택배 어디"]`로 의도를 생성하면, Then `201`과 함께 `exampleCount: 2`인 의도가 반환되고 목록에 나타난다.
- **AC-6-2** Given 의도 `주문_배송조회`가 존재, When `" 주문_배송조회 "`(공백 차이)로 다시 생성하면, Then `409`(`DUPLICATE_NAME`)가 반환되고 신규 레코드는 생성되지 않는다.
- **AC-6-3** Given 예문 배열에 `["택배 조회", "택배  조회", " 택배 조회"]`, When 저장하면, Then 정규화 중복이 제거되어 예문 1건만 저장되고 응답에 `deduplicatedCount: 2`가 포함된다.
- **AC-6-4** Given 예문에 빈 문자열/공백만 있는 값 포함, When 저장하면, Then `400`과 `details[].field = "examples[2]"` 형태의 위치 정보가 반환된다.
- **AC-6-5** Given 의도 A가 예문 "환불 되나요"를 이미 보유, When 의도 B에 같은 예문을 저장하면, Then 저장은 `200`으로 성공하되 응답 `conflicts`에 의도 A가 포함되고 화면에 경고 배너가 표시된다.
- **AC-6-6** Given 의도를 참조하는 `DialogNode`가 2건, When 의도 삭제를 요청하면, Then `409`(`INTENT_IN_USE`)와 함께 `details`에 노드 2건의 `{id, name}`이 반환되고 의도는 보존된다.
- **AC-6-7** Given 참조가 없는 의도, When 삭제하면, Then `204`이고 예문도 함께 제거된다.
- **AC-6-8** Given 의도 3건 중 1건이 노드에 참조 중, When 3건 일괄 삭제를 요청하면, Then `409`가 반환되고 **3건 모두 보존**된다(부분 삭제 없음).
- **AC-6-9** Given 키워드 `택배사`에 동의어 `한진`이 등록됨, When 다른 키워드 `운송사`에 동의어 `한진`을 추가하면, Then `409`(`SYNONYM_CONFLICT`)와 충돌 키워드명이 반환된다.
- **AC-6-10** Given 예문 500개인 의도, When 예문 1개를 더 추가하면, Then `400`과 현재 개수 안내가 반환된다.

### AC-6B. 엑셀/CSV 대량 업로드

- **AC-6B-1** Given 템플릿 다운로드, When 파일을 열면, Then 헤더가 `의도명, 예문`(+선택 `설명`)인 파일이 받아지고, 그대로 채워 업로드하면 오류 없이 검증을 통과한다.
- **AC-6B-2** Given 유효 962행 + 오류 7행 파일, When `import/validate`를 호출하면, Then `200`과 함께 `errors` 7건이 **행 번호·사유와 함께** 반환되고 **DB에는 아무것도 저장되지 않는다**.
- **AC-6B-3** Given 위 검증 결과의 `importToken`, When `SKIP_INVALID` + `MERGE`로 커밋하면, Then 유효 962행만 반영되고 기존 의도의 예문에 병합된다. 오류 7행은 반영되지 않는다.
- **AC-6B-4** Given 동일 상황, When `ABORT_ON_ERROR`로 커밋하면, Then `400`이 반환되고 **한 건도 반영되지 않는다**.
- **AC-6B-5** Given 커밋 중 DB 오류 발생, When 트랜잭션이 실패하면, Then 이전에 처리된 행도 모두 롤백되어 부분 반영이 남지 않는다.
- **AC-6B-6** Given 10분이 지난 `importToken`, When 커밋하면, Then `400`(`IMPORT_TOKEN_EXPIRED`)과 재검증 안내가 반환된다.
- **AC-6B-7** Given 6MB 파일 또는 5,001행 파일, When 업로드하면, Then `400`(`IMPORT_TOO_LARGE`)과 제한 값이 안내된다.
- **AC-6B-8** Given 셀 값이 `=1+1`인 행, When 저장 후 내보내기하면, Then 값이 수식으로 해석되지 않도록 이스케이프되어 출력된다.
- **AC-6B-9** Given UTF-8 BOM이 있는 CSV와 없는 CSV, When 각각 업로드하면, Then 한글이 깨지지 않고 동일하게 처리된다.
- **AC-6B-10** Given 업로드 진행 중, When 업로드 버튼을 연타하면, Then 요청은 1회만 발생하고 버튼은 비활성 상태를 유지한다.

### AC-7. 동음이의어/다의어 사전 (No.7)

- **AC-7-1** Given 단어 `배`에 의미 2건 이상, When 저장하면, Then `201`이 반환된다. 의미가 1건이면 `400`이다.
- **AC-7-2** Given 의미 A와 의미 B에 동일한 문맥 힌트 `항구`를 지정, When 저장하면, Then `400`과 중복 힌트 안내가 반환된다.
- **AC-7-3** Given 의미에 존재하지 않는 `intentId`를 지정, When 저장하면, Then `404`가 반환된다.
- **AC-7-4** Given 정책 `ASK`인 `배` 사전, When 테스트 입력 "배 얼마예요?"(힌트 없음)를 평가하면, Then 되묻기(`BUTTON` 아웃풋, 의미 label 버튼)가 반환된다.
- **AC-7-5** Given 동일 사전, When "항구에서 배 출발 시간"을 평가하면, Then `선박` 의미로 확정되고 연결 의도가 결과에 포함된다.
- **AC-7-6** Given 정책 `IGNORE`, When 모호한 입력을 평가하면, Then 되묻지 않고 기존 의도 매칭 결과를 그대로 반환한다.
- **AC-7-7** Given 사전 의미가 참조하는 의도, When 그 의도를 삭제하면, Then `409`가 반환된다.

### AC-9. FAQ 관리 (No.9)

- **AC-9-1** Given FAQ 목록, When 카테고리 `SMALL_TALK`로 필터하면, Then 해당 항목만 반환되고 카테고리별 건수 요약이 함께 온다.
- **AC-9-2** Given "영업시간 알려주세요" FAQ 존재, When 동일 문장을 다시 등록하면, Then `409`(`DUPLICATE_FAQ`)가 반환된다.
- **AC-9-3** Given 동일 FAQ 존재, When 입력란에 "영업시간이 어떻게 되나요?"를 입력하면, Then 400ms 디바운스 후 유사 후보가 최대 5건 표시되고 "기존 항목에 대체 질문으로 추가" 링크가 제공되며, **저장은 차단되지 않는다**.
- **AC-9-4** Given FAQ에 대체 질문 3건 등록, When 대체 질문 문장으로 매칭하면, Then 해당 FAQ의 답변이 반환된다.
- **AC-9-5** Given `enabled=false` FAQ, When 매칭을 시도하면, Then 그 FAQ는 후보에서 제외되고 목록에는 "비활성" 배지와 함께 보인다.
- **AC-9-6** Given `ERROR_RESPONSE` 항목이 0건인 챗봇, When FAQ 화면을 열면, Then 안내 배너가 표시되고, 매칭 실패 시 엔진은 시스템 기본 문구로 응답한다.
- **AC-9-7** Given `answer`에 `<script>alert(1)</script>`를 저장, When 목록·상세·미리보기를 렌더링하면, Then 스크립트가 실행되지 않고 문자 그대로 표시된다.
- **AC-9-8** Given `mode=public`으로 `/faqs/suggest`를 호출, When 응답을 받으면, Then `answer` 필드가 포함되지 않고 `{id, question}`만 반환된다.

### AC-8. 컨텍스트(멀티턴·슬롯필링) (No.8)

- **AC-8-1** Given 슬롯 3개(메뉴/사이즈/수량)인 `커피주문` 컨텍스트, When 세션을 시작하면, Then 첫 슬롯의 `prompt`가 출력되고 `currentSlotIndex: 0`, `status: IN_PROGRESS`인 세션 상태가 반환된다.
- **AC-8-2** Given 첫 슬롯이 `CHOICE`(아메리카노/라떼), When "아메리카노"를 입력하면, Then `filledValues.메뉴 = "아메리카노"`가 되고 두 번째 슬롯 질문이 출력된다.
- **AC-8-3** Given 슬롯 `수량`(NUMBER, 1~10), When "백만"을 입력하면, Then `retryCount`가 1 증가하고 `errorPrompt`가 재출력되며 슬롯은 진행되지 않는다.
- **AC-8-4** Given `maxRetry: 2`, When 3번 연속 잘못 입력하면, Then 세션이 `CANCELLED`로 종료되고 이탈 안내가 출력된다.
- **AC-8-5** Given 진행 중 세션, When "취소"를 입력하면, Then 슬롯 검증보다 우선해 즉시 `CANCELLED`로 종료되고 취소 문구가 출력된다.
- **AC-8-6** Given `lastInteractedAt`이 31분 전인 세션(`sessionTimeoutMinutes: 30`), When 새 입력이 오면, Then `EXPIRED` 처리 후 "이어서 하기 / 처음부터" 선택 버튼이 출력된다.
- **AC-8-7** Given 모든 필수 슬롯이 채워짐, When 마지막 값을 입력하면, Then `status: COMPLETED`가 되고 `completionMessage`의 `{메뉴}`/`{사이즈}`/`{수량}` 치환자가 실제 값으로 치환되어 출력된다.
- **AC-8-8** Given 선택 슬롯, When "건너뛰기"를 입력하면, Then 해당 슬롯 없이 다음 슬롯으로 진행한다.
- **AC-8-9** Given 컨텍스트를 참조하는 노드가 존재, When 컨텍스트를 삭제하면, Then `409`(`CONTEXT_IN_USE`)가 반환된다.
- **AC-8-10** Given `type=KEYWORD`인 슬롯이 참조하는 키워드, When 그 키워드를 삭제하면, Then `409`가 반환된다.
- **AC-8-11** Given 슬롯 0개로 컨텍스트 저장, When 요청하면, Then `400`이 반환된다.

### AC-5. 대화 그래프 빌더 (No.5)

- **AC-5-1** Given 의도 1건이 존재, When 그 의도를 조건으로 하고 `TEXT` 아웃풋 1개를 가진 노드를 생성하면, Then `201`이 반환되고 목록에 조건·아웃풋 요약이 표시된다.
- **AC-5-2** Given 인풋 조건이 비어 있는 `NORMAL` 노드, When 저장하면, Then `400`과 "조건을 1개 이상 지정하거나 시작/폴백 노드로 지정해 주세요" 안내가 반환된다.
- **AC-5-3** Given `START` 노드가 이미 1건, When 다른 노드를 `START`로 지정하면, Then `409`(`START_NODE_EXISTS`)가 반환된다.
- **AC-5-4** Given 존재하지 않는 `intentId`를 조건에 지정, When 저장하면, Then `404`와 문제된 ID가 `details`에 포함된다.
- **AC-5-5** Given `IMAGE` 아웃풋에 `altText` 미입력, When 저장하면, Then `400`(`OUTPUT_PAYLOAD_INVALID`)과 대체 텍스트 필수 안내가 반환된다.
- **AC-5-6** Given `LINK` 아웃풋의 `url`에 `javascript:alert(1)`, When 저장하면, Then `400`이 반환된다.
- **AC-5-7** Given `SURVEY` 아웃풋을 포함한 노드, When 저장하면, Then `201`로 저장되고 편집 화면에 "이번 버전에서는 실행되지 않습니다" 배지가 표시된다. **[No.27 기대값 변경 2026-09-24 — 의도된 변경]** v1(자유 문자열 `surveyId`) `SURVEY`는 이제 새로 저장할 수 없다 → **`400 SURVEY_OUTPUT_LEGACY_FORMAT`**. v2(`version: 2` + 같은 챗봇 설문)는 `201`이며 실행되므로 배지가 없다. 이미 저장된 v1은 읽기·표시되고 "이전 형식 — 실행되지 않음" 배지를 받는다(`survey-management-설계.md` §4.2·§18, ADR-0035 §9)
- **AC-5-8** Given 아웃풋 3개를 가진 노드, When 두 번째 아웃풋의 `위로` 버튼을 키보드 Enter로 실행하면, Then 순서가 바뀌고 포커스가 해당 버튼에 유지된다.
- **AC-5-9** Given 노드 A → B, B → A로 무조건 이동하는 설정, When 설계 점검을 실행하면, Then 순환 경로가 `WARNING`으로 검출되고 경로(A→B→A)가 표시된다.
- **AC-5-10** Given 아웃풋이 빈 노드 2건과 끊어진 참조 1건, When 설계 점검을 실행하면, Then 각각 `WARNING`/`ERROR`로 분류되어 총 3건이 리포트되고 항목마다 편집 화면 링크가 제공된다.
- **AC-5-11** Given 다른 노드가 `DIALOG_MOVE`로 참조하는 노드, When 그 노드를 삭제하면, Then `409`(`NODE_IN_USE`)가 반환된다.
- **AC-5-12** Given 노드 복사, When 실행하면, Then `{원본명} (사본)`으로 `enabled=false` 노드가 생성되고 원본은 변경되지 않는다.
- **AC-5-13** Given 노드가 0건인 챗봇, When 대화그래프 화면을 열면, Then 빈 상태 안내와 "의도 먼저 만들기" 바로가기가 표시되고 오류 화면이 아니다.
- **AC-5-14** Given `START` 노드와 이어지는 노드들, When 흐름 미리보기를 열면, Then 트리 형태로 표시되고 키보드만으로 펼침/접기가 가능하며 반복 경로는 "↩ 반복"으로 접힌다.

### AC-E. 매칭 엔진 통합

- **AC-E-1** Given 의도 `주문_배송조회`를 조건으로 하는 노드가 존재, When 입력 "배송 조회"를 `resolveResponse`로 해석하면, Then `matchedNodeId`가 그 노드이고 **노드의 outputs가 반환**된다(의도 단독 문자열 응답이 아니다).
- **AC-E-2** Given 동일 입력에 매칭되는 FAQ와 노드가 모두 존재, When 해석하면, Then **노드가 우선**한다(FR-E-3 ③ > ④). `trace`에 FAQ가 후순위로 밀린 근거가 남는다.
- **AC-E-3** Given `priority` 200 노드와 100 노드가 같은 의도를 조건으로 가짐, When 해석하면, Then `priority` 200 노드가 선택된다.
- **AC-E-4** Given `enabled=false` 노드, When 그 조건에 맞는 입력을 해석하면, Then 해당 노드는 선택되지 않는다.
- **AC-E-5** Given `matchMode=ALL`이고 의도+키워드 조건을 가진 노드, When 의도만 충족하는 입력을 해석하면, Then 그 노드는 매칭되지 않는다.
- **AC-E-6** Given `CONTEXT_FORM` 아웃풋을 가진 노드, When 해석하면, Then 첫 슬롯 질문이 출력되고 `nextSession.status = IN_PROGRESS`가 반환된다.
- **AC-E-7** Given `IN_PROGRESS` 세션이 있는 상태, When 노드 조건에도 맞는 입력이 오면, Then **세션 진행이 우선**하고 슬롯 값으로 해석된다(FR-E-3 ①).
- **AC-E-8** Given A→B→A 순환 이동 노드, When 해석하면, Then 10회 이동 후 중단되고 `trace`에 `HOP_LIMIT_EXCEEDED`가 남으며 예외가 발생하지 않는다.
- **AC-E-9** Given 삭제된 의도를 참조하는 손상된 노드가 번들에 섞여 있음, When 해석하면, Then 예외 없이 해당 노드를 건너뛰고 `trace`에 경고가 남는다.
- **AC-E-10** Given 아무 것도 매칭되지 않는 입력, When 해석하면, Then `FALLBACK` 노드 → `ERROR_RESPONSE` FAQ → 기본 문구 순으로 폴백하고 최소한 하나의 응답은 항상 반환된다.
- **AC-E-11** Given 기존 `simulate(input, intents, faqs)` 호출부, When 리팩터링 후 실행하면, Then 기존 단위 테스트가 통과한다(하위호환).
- **AC-E-12** Given 의도 1,000건/예문 20,000건/노드 500건/FAQ 2,000건 번들, When 100회 해석을 측정하면, Then P95가 200ms 이내다.

### AC-C. 공통/횡단

- **AC-C-1** 모든 엔드포인트 응답이 대응하는 zod 스키마 파싱을 통과한다(계약 테스트).
- **AC-C-2** `ARCHIVED` 챗봇에 대해 이 그룹의 쓰기 API를 호출하면 전부 `409`(`CHATBOT_ARCHIVED`)를 반환하고, 조회는 `200`이다.
- **AC-C-3** 다른 챗봇의 의도 ID로 노드 조건을 저장하면 `404`가 반환된다(존재 여부를 노출하지 않음).
- **AC-C-4** 의도 추가 → 노드 생성 → FAQ 등록 → 설계 점검까지 전 과정을 **마우스 없이 키보드만으로** 완료할 수 있다.
- **AC-C-5** axe 등 자동 접근성 스캔에서 대비 4.5:1 미만 요소 0건이다.
- **AC-C-6** 삭제·일괄삭제·업로드 커밋 확인 모달에서 `Esc`로 취소하면 아무 변경도 발생하지 않고 포커스가 트리거로 복귀한다.
- **AC-C-7** 영문/일문/이모지가 포함된 의도명·예문·FAQ 답변이 저장·조회·CSV 내보내기에서 깨지지 않는다.
- **AC-C-8** DB의 JSON 문자열 필드(`examples`/`outputs`/`slots`/`meanings`)가 손상된 경우 목록 조회가 500으로 실패하지 않고 기본값 폴백 + 경고 로그로 처리된다.

---

## 8. 예외 케이스 정리

### 8.1 참조 무결성·삭제

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-R-1 | 노드가 참조 중인 의도 삭제 | `409` `INTENT_IN_USE` + 참조 노드 목록(최대 5건) + 바로가기 |
| EX-R-2 | 동음이의어 의미가 연결한 의도 삭제 | `409` + 사전 항목 안내 |
| EX-R-3 | 노드/컨텍스트 슬롯이 참조 중인 키워드 삭제 | `409` `KEYWORD_IN_USE` |
| EX-R-4 | 노드가 참조 중인 컨텍스트 삭제 | `409` `CONTEXT_IN_USE` |
| EX-R-5 | `DIALOG_MOVE` 대상 노드 삭제 | `409` `NODE_IN_USE` |
| EX-R-6 | 일괄 삭제 중 일부만 참조됨 | 전체 롤백 + `409` + 차단 항목 목록(부분 성공 금지) |
| EX-R-7 | 삭제 검사 통과 후 커밋 직전 다른 사용자가 참조를 추가(경합) | DB FK 오류(P2003)를 `409`로 매핑해 동일 메시지 반환 |
| EX-R-8 | 챗봇 영구 삭제 시 이 그룹 하위 데이터 존재 | 기존 정책대로 `409`(No.1 FR-1-16) — 변경 없음 |

### 8.2 대화그래프·매칭

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-D-1 | `DIALOG_MOVE` 순환(A→B→A) | 저장 허용 + 설계 점검 `WARNING` + 런타임 hop limit 10회로 중단 |
| EX-D-2 | 같은 조건을 가진 노드 2건 | 저장 허용 + 점검 `WARNING`. 실행은 `priority`/타이브레이크로 1건만 선택(비결정적 동작 금지) |
| EX-D-3 | 아웃풋 0개 노드 | `enabled=true`면 `400`, `enabled=false`면 저장 허용 + 점검 `WARNING` |
| EX-D-4 | `FALLBACK` 노드 없음 + `ERROR_RESPONSE` FAQ 없음 | 시스템 기본 문구로 응답. 점검 `INFO` |
| EX-D-5 | 예문 0개 의도를 조건으로 쓰는 노드 | 저장 허용 + 점검 `WARNING`(영원히 매칭 안 됨) |
| EX-D-6 | 실행 미지원 아웃풋(SCENARIO/SURVEY/API_CONDITION)만 가진 노드 | 매칭은 되나 출력이 비므로, 엔진이 `unsupportedOutputs`를 채우고 안내 문구로 폴백 |
| EX-D-7 | 입력이 빈 문자열/공백/제어문자만 | 매칭 시도하지 않고 재입력 안내. `400`이 아니라 정상 응답 |
| EX-D-8 | 입력이 매우 긺(1,000자 초과) | 앞 1,000자만 매칭에 사용하고 `trace`에 절단 기록 |
| EX-D-9 | 노드/의도/FAQ가 전부 0건인 신규 챗봇 | 엔진은 기본 문구로 정상 응답. 화면은 빈 상태 안내 |

### 8.3 컨텍스트 세션

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-S-1 | 세션 진행 중 타임아웃(기본 30분) | `EXPIRED` + "이어서 하기 / 처음부터" 선택. 기본은 새로 시작 |
| EX-S-2 | 세션 진행 중 취소어 입력 | 즉시 `CANCELLED`(슬롯 검증보다 우선) |
| EX-S-3 | 재시도 초과 | `CANCELLED` + 이탈 안내 + fallback 경로 |
| EX-S-4 | 세션이 참조하는 컨텍스트가 편집·삭제됨(진행 중 변경) | 슬롯 구조 불일치 감지 시 세션을 `CANCELLED`로 종료하고 재시작 안내(값 유실 고지). 삭제는 EX-R-4로 애초에 차단 |
| EX-S-5 | 슬롯 값이 금지어/비속어 | 이번 Phase는 필터링하지 않음. No.12 도입 시 검증 지점(슬롯 값 확정 직전)만 표시 |
| EX-S-6 | 슬롯 값이 전화번호·이메일 등 PII | 저장은 하되 서버 로그 원문 금지(NFR-S9), 대화로그 마스킹은 대화처리 Phase |
| EX-S-7 | 동일 사용자가 두 컨텍스트를 동시에 시작 | 세션은 1개만 유지. 새 `CONTEXT_FORM` 실행 시 기존 세션을 `CANCELLED` 처리하고 전환 고지 |

### 8.4 대량 업로드

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-I-1 | 헤더가 템플릿과 불일치 | `400` + 기대 헤더 안내 + 템플릿 다운로드 링크 |
| EX-I-2 | 인코딩 불일치(EUC-KR 등)로 한글 깨짐 | 검증 단계에서 감지해 `400` + "UTF-8로 저장 후 다시 업로드" 안내 |
| EX-I-3 | 파일 내 중복 행 | 오류 아님. `duplicatedRows`로 집계 후 1건만 반영 |
| EX-I-4 | 빈 파일/헤더만 있는 파일 | `400` + "데이터 행이 없습니다" |
| EX-I-5 | 셀 값 수식(`=`, `+`, `@` 시작) | 텍스트로 저장, 내보내기 시 이스케이프 |
| EX-I-6 | 토큰 만료 후 커밋 | `400` `IMPORT_TOKEN_EXPIRED` |
| EX-I-7 | 커밋 중 서버 오류 | 전체 롤백 + `500` + 재시도 안내(부분 반영 금지) |
| EX-I-8 | 업로드 중 브라우저 이탈 | 서버는 dry-run 결과만 보관, 커밋되지 않았으므로 데이터 변화 없음 |
| EX-I-9 | 동시에 두 관리자가 같은 챗봇에 업로드 커밋 | 트랜잭션 직렬화. 나중 커밋이 `MERGE` 정책이면 병합, `REPLACE`면 last-write-wins(§8.5 EX-X-2와 동일 정책) |

### 8.5 공통

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-X-1 | `ARCHIVED` 챗봇에 쓰기 시도 | `409` `CHATBOT_ARCHIVED` + UI 편집 비활성 |
| EX-X-2 | 두 관리자가 같은 노드를 동시 수정 | Phase 1은 last-write-wins. 응답의 `updatedAt`으로 화면 갱신(No.1 D-4 정책 승계) |
| EX-X-3 | 관리자 세션 만료(No.12 도입 후) | `401` 수신 시 편집 중 내용을 로컬 보존한 채 재로그인 유도. 이번엔 훅 자리만 확보 |
| EX-X-4 | 금지어/비속어가 의도명·FAQ 답변에 입력 | 이번 Phase는 차단하지 않음. No.12 필터 적용 지점(저장 전 검증)만 표시 |
| EX-X-5 | 다국어(영문/일문/중문) 예문·답변 | UTF-8로 정상 저장·매칭. 단 형태소 분석·언어 감지는 미지원이며, 매칭은 정규화 기반 문자열 비교임을 문서로 고지 |
| EX-X-6 | JSON 필드 손상 | 기본값 폴백 + 경고 로그, 화면 정상 표시(NFR-M4) |
| EX-X-7 | 교차 챗봇 리소스 접근 | `404`(존재 노출 금지) |

---

## 9. Out of scope (이번 Phase 제외)

### 9.1 다른 기능그룹 — 별도 Phase

- **품질/채널 그룹 No.10~11 — 별도 Phase.** No.10(응답 테스트/시뮬레이션, 운영 vs 학습중 챗봇 실시간 비교)과 No.11(웹/모바일/카카오톡/라인/페이스북/네이버톡톡/앱/키오스크 채널 배포·Webhook)은 이번 범위가 아니다. 이번 Phase는 **엔진 코어(순수 함수)와 그 입력 데이터**까지만 만들고, 시뮬레이터 UI·대화 API(REST/WS)·채널 어댑터·아웃풋의 실제 렌더링은 No.10/11에서 구현한다.
- **관리/보안 No.12~13**(회원·권한·RBAC·금지어 필터·감사 이력), **통계/분석 No.14~15**(기본 통계, 학습현황 재학습) — 별도 Phase. 이번엔 권한 데코레이터 부착과 `AuditLog` 기록 지점(서비스 단일 진입점)만 확보한다.
- **확장기능/옵션 No.16~47 전체.** 특히 **No.16 딥러닝 학습엔진(DLE) 증강학습은 명확히 범위 밖**이다. 이번 그룹의 매칭은 **정규화 기반 규칙 매칭(정확일치/부분일치/토큰 유사도)** 만 사용하며, 유사 의미 증강·임베딩 유사도(No.18)·군집분석(No.21)·생성형 RAG(No.30)는 도입하지 않는다. 따라서 "의미는 같지만 표현이 다른 문장"의 매칭률 한계는 **알려진 제약**으로 문서화하고, 관리자는 예문·대체질문을 늘려 대응한다.

### 9.2 대화그래프 비주얼 캔버스 — 이번 Phase 제외(§4.5.1 결정)

- **드래그앤드롭 그래프 캔버스**(노드 배치, 연결선 드로잉, 줌/팬, 미니맵, 자동 레이아웃)는 제외한다. 근거는 §4.5.1의 4개 항목(접근성 기준 충돌 / 엣지·좌표 모델 미확정 / 우선순위는 실행기 / 대체 수단 제공)이다.
- 대신 제공: 리스트+폼 기반 노드 편집(FR-5-1~11), 읽기전용 흐름 요약 트리(FR-5-19), 설계 점검(FR-5-16).
- 후속 대비: `canvasX`/`canvasY` nullable 컬럼을 지금 추가(DD-2)해 데이터 모델 재작업을 예방한다. 캔버스 도입 시에도 **폼 기반 편집 경로는 키보드 접근성 대체 수단으로 존치**해야 한다.

### 9.3 기타 제외 항목

| 항목 | 제외 사유 / 이관 대상 |
|---|---|
| `SCENARIO`(기간계 연동)·`API_CONDITION` 아웃풋의 **실제 실행**(외부 API 호출, 응답 매핑, SSRF 방어) | No.26(레거시 API 연동). 이번엔 정의·저장·형식 검증까지 |
| `SURVEY` 아웃풋의 **실제 설문 생성·응답 수집·통계** | No.27(설문관리). 이번엔 `surveyId` 참조 저장까지 **[이행 2026-09-24 — `survey-management-설계.md` · ADR-0035. 기존 자유 문자열 `surveyId`(v1)는 실체가 없는 예약 자리였으므로 자동 연결하지 않고, 설문 선택(v2)으로 전환해야 실행된다]** |
| 컨텍스트 세션의 **영속화·만료 정리 배치·분산 저장(Redis)** | 대화처리/No.10 Phase(FR-8-15). 이번엔 stateless 상태 계약만 |
| 대화 로그(`ConversationLog`) 기록 | 대화처리 Phase. 이번 그룹은 로그를 생성하지 않는다 |
| 의도/FAQ **자동 생성·자동 분류·LLM 초안 생성** | No.38(노코드 프롬프트 기반 시나리오 설계) |
| **임베딩 기반 의미 유사도** FAQ 추천·의도 매칭 | No.18(Text Embedding Manager) |
| 형태소 분석기·품사 태깅·언어 감지 | 미도입(EX-X-5). 규칙 기반 정규화 매칭만 |
| 대화 자산의 **버전 스냅샷·롤백·환경 분리 배포** | No.25(버전 이력), No.28(예약 배포), No.40(Dev/Staging/Prod) |
| **대량 검증(TC 테스트)·학습영향도 비교** | No.19, No.20 |
| 토픽 시스템(멀티 온톨로지)·부서별 토픽 분리 | No.22 **[설계 완료 2026-09-25 — 챗봇 안 평면 토픽 · 비활성 토픽은 번들 조립에서 제외(엔진 0) · `topic-system-설계.md` · ADR-0037]** |
| 챗봇 간 대화 자산 **복사/이관 UI** | 이번엔 CSV 내보내기/가져오기로 우회(FR-6-30). 전용 마이그레이션 기능은 후속 **[부분 이행 2026-09-25 No.22 — 토픽 → 새 챗봇 분리(복사·ID 재매핑, 전체 선택 = 깊은 복사)가 첫 구현. 기존 챗봇으로 옮겨 넣기(병합)는 2차 — 충돌 규칙은 `topic-system-설계.md` §10]** |
| 채널별 리치 메시지 컴포넌트(카카오 캐러셀 등) | No.46(보완 제안, 미확정) |
| 관리자 콘솔 UI 다국어(i18n) | 한국어 고정(FR-0-8 상속). 문자열 상수 집약까지만 |
| 금지어/비속어 필터 적용 | No.12(EX-X-4) |
| 낙관적 잠금·동시 편집 충돌 해결 | Phase 1 last-write-wins(EX-X-2) |
| 노드/의도 편집 이력(누가 언제 무엇을) | No.13(AuditLog). 서비스 단일 진입점만 유지 |

---

## 10. `기능요구사항.md` 및 상위 문서 갱신 제안

기준 목록(`docs/01-requirements/기능요구사항.md` §2)과 대조한 결과 **기능 항목의 추가·삭제는 불필요**하다. 아래 설명 보강 5건과 상위 명세서 정정 2건만 제안한다(반영 여부는 PM 확인 후 결정).

| 대상 | 현재 문구 | 제안 |
|---|---|---|
| §2 No.5 | "노드 기반 인풋(의도/키워드/컨텍스트)-아웃풋 설계. 아웃풋 12종 이상…" | 동일 + 비고 "**1차 범위는 리스트/폼 기반 편집 + 읽기전용 흐름 요약**이며, 드래그앤드롭 비주얼 캔버스는 후속 확장(`dialogue-design.md` §4.5.1·§9.2). 아웃풋 12종 중 SCENARIO/SURVEY/API_CONDITION 3종은 정의·저장까지만 지원하고 실행은 No.26/No.27에서 연결" |
| §2 No.5 | — | **각주 추가**: "노드가 실제로 동작하려면 `packages/dialogue-engine`에 **대화그래프 실행기**가 필요하다(현행 `matchIntent`는 노드를 참조하지 않음) — `dialogue-design.md` §1.3·§4.6" |
| §2 No.6 | "의도/키워드 등록·수정·삭제, 엑셀 대량 업로드 예문 등록" | 동일 + "**업로드는 검증(dry-run) → 확정 커밋 2단계**이며 병합/덮어쓰기/건너뛰기 정책과 오류 행 리포트를 제공. 내보내기(CSV)도 포함" |
| §2 No.7 | "동음이의어·다의어를 사전 등록해 의도 매칭 정확도 향상" | 동일 + "의미별 **문맥 힌트·연결 의도**를 두고, 모호할 때 되묻기(ASK)/기본의미(DEFAULT_MEANING)/무시(IGNORE) 정책을 선택" |
| §2 No.9 | "FAQ/스몰톡/셀프서비스/오류 응답 세트 분류 관리, 자동완성" | 동일 + "**‘자동완성’은 1차에서 (a) 관리자 중복/유사 등록 방지 추천 (b) 위젯 자동완성용 후보 조회 API 2가지를 의미하며, 규칙 기반**이다. 임베딩 의미 유사도는 No.18" |
| `개발명세서.md` §4 | 대화 설계 경로에 `/entities` | **`/keywords`로 정정**(Prisma 모델·모듈명과 일치). 경로는 `/chatbots/:chatbotId/...` 중첩 형태로 통일(FR-0-9) |
| `개발명세서.md` §3 | `Entity`(Keyword) 행 | 명칭을 `Keyword`로 통일하고, `DialogNode`↔`Intent`/`Keyword` 사이에 **조인 테이블 도입 검토(DD-5)** 를 비고로 기재 |

`docs/04-test/시험항목.md`에는 이 그룹 케이스가 없으므로 **TC-05(대화그래프)·TC-06(의도/키워드+업로드)·TC-07(동음이의어)·TC-08(컨텍스트)·TC-09(FAQ)·TC-EN(엔진 통합)** 추가를 `test-automation` 단계에서 제안한다.

---

## 11. 다음 단계 인계 사항

| 대상 에이전트 | 확인/결정 필요 사항 |
|---|---|
| `system-architect` | ① **DD-5 조인 테이블 도입 여부**(역참조 성능·정확도 — 이 그룹 최대 설계 판단) ② DD-4 정규화 유일성 구현 방식(A: `nameNormalized` 컬럼 / B: 서비스 사전검사) ③ DD-2 `DialogNode` 필드 확장 + 캔버스 좌표 선반영 ④ DD-6 `contextVariableId` FK 승격 ⑤ DD-7 `importToken` 보관 전략 ⑥ **DD-8 xlsx 파서 의존성 도입 vs CSV 우선 축소안** ⑦ FR-5-13 아웃풋 payload 판별 유니온 스키마 12종 설계 ⑧ **FR-E 엔진 실행기 인터페이스 확정 및 `simulate` 하위호환 전략** ⑨ §5.4 엔드포인트 확정 + `개발명세서.md` §3/§4 정정(§10) ⑩ 6개 모듈(`intents`/`keywords`/`homonyms`/`contexts`/`dialog-nodes`/`faqs`)의 4계층 파일 구조 |
| `ui-designer` | ① **챗봇 상세 탭 구조** — 기존 3탭(dashboard/settings/skin)에 5개를 평면 추가하면 8탭이 되어 과밀하므로 **"대화설계" 상위 탭 + 좌측 서브내비(대화그래프/의도·키워드/동음이의어/컨텍스트/FAQ)** 구조를 권고, 최종 판단 필요 ② 노드 편집 폼(인풋 조건 선택기 + 아웃풋 12종 타입별 폼 + 순서 변경 버튼) ③ 읽기전용 흐름 요약 트리(키보드 펼침/접기) ④ 설계 점검 결과 패널(심각도 배지 + 바로가기) ⑤ 대량 업로드 3단계 UI(파일선택 → 검증 리포트 → 확정) ⑥ 슬롯 편집 + 대화형 미리보기 ⑦ 빈 상태 5종 ⑧ 전부 `UIUX_준수기준.md` 준수(드래그 금지, 대체 텍스트 필수, 색상+텍스트 병기) |
| `backend-implementer` | §4 FR + §7 AC 기준 6개 NestJS 모듈 구현 및 `app.module.ts` 등록. 참조 검사·정규화·설계 점검은 `lib/*` 순수 함수로 분리(NFR-M1). 대량 업로드는 단일 트랜잭션(FR-6-26) |
| `frontend-implementer` | `apps/web` 신규 화면 5종 + 라우트 추가(`App.tsx`, `TabNav`). 기존 `UnsavedGuardContext`·`ConfirmDialog`·`Toast`·`MESSAGES` 패턴 재사용. 파일 업로드 진행/오류 표시 컴포넌트 신규 필요 |
| `test-automation` | §7 AC 전체를 테스트로 전환. **엔진 단위 테스트(AC-E)가 최우선**이며 성능 테스트(AC-E-12)는 시드 생성 스크립트 필요. seed에 NFR-M5 샘플 + 자산 0건 챗봇 추가 |
