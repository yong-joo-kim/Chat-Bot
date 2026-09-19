# ADR-0005 — 대화 노드의 인풋 조건 참조를 조인 테이블로 전환 (JSON 컬럼 폐지)

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/dialogue-design.md` §5.2 DD-5·DD-6, FR-5-5, FR-6-8, FR-6-11, FR-6-18, FR-8-6, NFR-P1, NFR-P2, EX-R-1 ~ EX-R-5
- **영향 범위**: `apps/api/prisma/schema.prisma`, `apps/api/src/dialog-nodes/*`, `apps/api/src/intents/*`, `apps/api/src/keywords/*`, `apps/api/src/dialogue-common/reference-check.service.ts`

## 맥락

Phase 0 스캐폴딩의 `DialogNode`는 인풋 조건을 **JSON 직렬화 문자열**로 보관한다.

```prisma
intentIds         String  @default("[]")   // JSON 직렬화된 string[]
keywordIds        String  @default("[]")
contextVariableId String?                  // FK 아님, 단순 문자열
```

이 구조 위에서 이번 그룹이 요구하는 두 기능이 성립하지 않는다.

1. **`linkedNodeCount`(FR-6-8, FR-6-17)** — 의도/키워드 **목록 화면마다** "이 의도를 참조하는 노드 수" 배지를 표시해야 한다. JSON 컬럼으로 하려면 (a) 챗봇의 전체 노드를 읽어 JSON을 파싱해 앱에서 세거나, (b) 의도마다 `WHERE intentIds LIKE '%<id>%'`를 날려야 한다. (a)는 목록 1회당 전량 스캔, (b)는 **의도 개수만큼의 N+1**이다. 의도 1,000건 목록 P95 300ms(NFR-P1)를 만족할 수 없다.
2. **삭제 사전 검사(FR-6-11, FR-6-18, EX-R-1/R-3)** — "이 의도를 쓰는 노드가 2건 있습니다"를 정확히 말해야 한다. `LIKE '%<uuid>%'`는 **부분 문자열 오탐**이 가능하고(uuid 일부가 다른 uuid에 포함될 수 있으며, 무엇보다 `intentIds`와 `keywordIds`를 구분하지 못한다), DB가 참조 무결성을 보장하지 못해 **고아 참조**가 조용히 쌓인다. ADR-0002가 세운 "삭제는 사전검사 409 + `Restrict`가 최종 방어선" 구조에서 **최종 방어선이 통째로 비어 있는** 상태다.

## 결정

1. **조인 테이블 2개를 신설한다.**
   - `DialogNodeIntent(nodeId, intentId)` — `@@id([nodeId, intentId])`, `@@index([intentId])`
   - `DialogNodeKeyword(nodeId, keywordId)` — `@@id([nodeId, keywordId])`, `@@index([keywordId])`
2. **기존 `intentIds`/`keywordIds` JSON 컬럼은 완전히 제거한다.** 파생 캐시로도 남기지 않는다.
3. **`DialogNode.contextVariableId`를 FK로 승격한다**(DD-6) — `ContextVariable?` 관계 + `onDelete: Restrict, onUpdate: Cascade`.
4. **조인 테이블의 `onDelete`는 양쪽 모두 `Restrict`**다(DD-15). 노드 삭제·수정 시 링크 행은 **서비스 트랜잭션에서 명시적으로 선삭제**한다.
5. **API 계약은 바뀌지 않는다.** 요청·응답의 `intentIds: string[]` / `keywordIds: string[]`은 그대로 유지하고, `dialog-node.mapper.ts`가 링크 행 ↔ 배열을 변환한다. `shared-types`·프런트에 파괴적 변경이 없다.
6. **아웃풋 payload 안의 참조**(`DIALOG_MOVE.targetNodeId`, 버튼 `NODE` 액션, `CONTEXT_FORM.contextVariableId`)는 **JSON에 남긴다.** FK로 끌어올리지 않는다.
7. 마이그레이션은 **3단계**로 수행한다: 컬럼·테이블 추가 → 애플리케이션 백필 스크립트(JSON → 링크 행 이관) → 유니크/FK 적용 + JSON 컬럼 DROP (`dialogue-design-설계.md` §3.2).

## 근거

- **`_count` 한 줄로 끝난다.** `prisma.intent.findMany({ include: { _count: { select: { nodeLinks: true } } } })` 1쿼리로 `linkedNodeCount`가 나온다. `@@index([intentId])` 덕분에 삭제 사전 검사도 인덱스 조회 1회다(NFR-P2 200ms 대비 충분한 여유).
- **DB가 참조 무결성을 보장한다.** 의도를 지우려 하면 `Restrict`가 막고, 경합으로 사전검사를 통과해도 `P2003`이 전역 필터에서 `409 INTENT_IN_USE`로 변환된다(EX-R-7). ADR-0002가 설계한 2중 구조(사전검사=UX, 제약=방어선)가 이 그룹에서도 동일하게 성립한다.
- **부분 문자열 오탐이 원천적으로 사라진다.** 관계는 값이 아니라 행이 된다.
- **JSON 컬럼을 "파생 캐시"로 남기지 않는 이유**: 두 벌의 진실은 언젠가 반드시 어긋난다. 어긋나면 화면(캐시)과 삭제 차단(조인)이 서로 다른 답을 주고, 그 버그는 재현이 어렵다. 읽기 성능을 위한 비정규화가 필요할 만큼의 규모(노드 500건)도 아니다.
- **`contextVariableId` FK 승격이 싸다.** 어차피 `dialog_nodes` 테이블이 JSON 컬럼 DROP으로 재생성되므로, FK 추가에 추가 비용이 사실상 없다.
- **아웃풋 payload 참조를 FK로 올리지 않는 이유**: 그러려면 아웃풋을 별도 테이블(`DialogOutput` 행 단위)로 분해해야 하는데, 이는 12종 판별 유니온 payload를 관계형으로 펼치는 대공사이고 **이번 Phase가 의도적으로 미룬 엣지 모델(DD-14)과 한 묶음**이다. 반면 이 참조들의 검사 시점은 **저장 시 1회 + 삭제 시 1회**뿐이라 `chatbotId`로 범위를 한정한 JSON 파싱 비교로 충분하다(노드 ≤500건). DD-5가 문제였던 이유는 "목록 조회마다 반복"이었지, "JSON이라서"가 아니다.

### `onDelete: Cascade`를 쓰지 않은 이유 (DD-15)

링크 행은 노드 애그리거트의 일부이므로 `node → Cascade`가 관용적이고 코드가 한 줄 줄어든다. 그럼에도 `Restrict`를 택했다.

- ADR-0002가 **"DB 암묵 cascade 0건"** 을 이 저장소의 규약으로 세웠다. 예외를 한 번 만들면 "여기는 되는데 왜 저기는 안 되나"라는 리뷰 논쟁이 반복되고, 규약의 억지력이 떨어진다.
- 노드 수정은 어차피 **링크 전체 교체(deleteMany + createMany)** 를 트랜잭션에서 수행한다. 삭제 경로가 같은 헬퍼를 재사용하므로 **추가 비용이 사실상 0**이다.
- 서비스가 모든 삭제의 단일 진입점으로 남아, No.13 `AuditLog`가 "어떤 링크가 지워졌는지"를 기록할 지점이 유지된다(FR-0-7).

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| JSON 유지 + 앱 레벨 카운트 캐시(`Intent.linkedNodeCount` 컬럼) | 비정규화 카운터는 노드 쓰기마다 갱신이 필요하고, 누락되면 **틀린 숫자로 삭제를 막거나 허용**한다. 정확도가 UX보다 중요한 지점 |
| JSON 유지 + `LIKE` 조회 | 부분 문자열 오탐, 인덱스 미사용, `intentIds`/`keywordIds` 미구분. NFR-P1/P2 위반 |
| JSON 유지 + 조인 테이블 **병행**(파생 캐시) | 두 벌의 진실. 동기화 누락 버그가 조용히 발생하며 재현이 어렵다 |
| 아웃풋까지 전부 테이블로 정규화 | 판별 유니온 12종을 관계형으로 펼치는 대공사. 엣지 모델(DD-14)과 함께 후속 Phase에서 검토 |
| 지금은 두고 No.10에서 전환 | 이 그룹의 목록/삭제 기능이 **지금** 성능·정확도 요구를 받는다. 데이터가 쌓인 뒤 전환하면 백필 위험만 커진다(현재 `dialog_nodes` 0건 = **전환 비용이 최저인 시점**) |

**감수하는 비용**: ① 테이블 2개와 mapper 변환 코드가 늘어난다. ② 노드 저장이 단일 `update`가 아니라 3~5문의 트랜잭션이 된다(노드 500건 규모에서 무시 가능). ③ SQLite 테이블 재생성 마이그레이션이 1회 발생한다(현재 행 0건이라 무해).

## 결과

- `schema.prisma`: `DialogNodeIntent`/`DialogNodeKeyword` 신설, `DialogNode.intentIds`/`keywordIds` 삭제, `contextVariableId` FK 승격, `Intent.nodeLinks`/`Keyword.nodeLinks` 역관계 추가.
- `dialog-nodes/lib/node-links.ts`(순수): 기존 링크 집합과 요청 집합의 diff 계산.
- `dialogue-common/reference-check.service.ts`: 삭제 사전검사 단일 진입점(상위 5건 `ResourceRef` 반환 — FR-0-10 UI 바로가기).
- `all-exceptions.filter.ts`: `P2003` → `409 *_IN_USE` 매핑 확장(기존 `CHATBOT_HAS_CHILDREN` 분기에 대상별 코드 추가).
- 후속: 캔버스 Phase에서 `DialogNodeEdge`(명시적 엣지) 도입을 검토할 때, 본 ADR의 조인 테이블 패턴을 그대로 재사용한다.
