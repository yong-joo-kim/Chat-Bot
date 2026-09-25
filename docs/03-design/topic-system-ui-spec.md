# 토픽 시스템 (No.22) — 화면 설계서

> **대상 기능**: No.22 토픽 시스템(멀티 온톨로지) — 1차-A **챗봇 안의 토픽**(대화 자산 6종을 부서·주제별로 묶어 필터·일괄 지정·활성/비활성·교차 참조 점검·토픽 단위 내보내기/가져오기) + 1차-B **토픽 → 새 챗봇 분리**(복사·ID 재매핑). **병합은 2차**이므로 이 문서는 병합 화면을 만들지 않는다.
> **입력 문서**: `docs/requirements/topic-system.md`(T-1~10, J-1~J-18, FR-0-129~137, FR-TP1~TP8, NFR-TPP/TPS/TPA/TPM, AC-TP1~TP7, EX-TP-1~24, PM 결정 P-1~P-16 §11), `docs/02-spec/topic-system-설계.md`(§2 아키텍처, §3 데이터모델, §4 shared-types, §5~§11 도메인별 설계, §14 권한, §15 감사, §16 API 계약 11개, §20 관리자 콘솔 인계), `docs/02-spec/decisions/ADR-0037-*.md`
> **준수 기준**: `docs/03-design/UIUX_준수기준.md`(전 항목 — 이번 작업은 **신규 보강이 필요 없다**, §8 근거)
> **선례 참고**: `docs/03-design/hybrid-cs-ui-spec.md`(최신 문서 형식 — 화면목록 표·공통 배지·필드-오류 매핑·messages.ts 나열 방식을 그대로 계승), `docs/03-design/dialogue-design-ui-spec.md`(서브내비 구조·목록 6화면 레이아웃·`DesignValidationPanel`·`ResourcePickerField`·대량 업로드 흐름 — 이번에 필요한 부분을 갱신), `docs/03-design/version-history-ui-spec.md`(`RestoreDialog`·`RestoreWarningList`·`ActiveChatbotAcknowledgeCheckbox` — 복원 경고 2종 추가에 재사용), `docs/03-design/chatbot-operations-ui-spec.md`(`CopyChatbotModal` — 분리 마법사 3단계 "이름·slug·그룹" 재사용)
> **실제 코드 확인**: `apps/web/src/pages/dialogue/DialogueShell.tsx`(서브내비 7항목 `nodes|intents|homonyms|contexts|faqs|surveys|cannedResponses` — 8번째로 `topics` 추가), `apps/web/src/App.tsx`(챗봇 상세 하위 라우트 — `simulator`·`learning`·`versions` 기존 라우트 확인, 신규 최상위 라우트 0), `apps/web/src/components/ResourcePickerField.tsx`(검색형 선택기 8종 패턴 — 토픽은 이 패턴 대신 별도 경량 컴포넌트를 쓴다, §2.2 근거), `apps/web/src/components/MultiSelectDropdown.tsx`(다중선택 체크박스 드롭다운 — 목록 필터에 재사용), `apps/web/src/constants/messages.ts`
> **작성**: ui-designer · 2026-09-25 · **다음 단계**: `backend-implementer`(K-1 선행 커밋 → 본체) → `frontend-implementer` → `code-reviewer` → `test-automation`
> **범위 경계**: 실제 React/TS 컴포넌트 코드는 작성하지 않는다. 병합(2차)·공유 토픽 패키지·토픽 우선 라우팅 화면은 이 문서에서 다루지 않는다(범위 밖 — 요구사항 §9).

---

## 0. 전제와 연계 확인

1. **PM 확정 사항(2026-09-25)을 그대로 따른다**(요구사항 §11). 이 문서가 화면으로 구체화할 뿐 재론하지 않는 핵심만 다시 적는다.
   - 1차 범위 = 챗봇 안 토픽(A) + 토픽 → 새 챗봇 **분리(복사)**(B). **병합 화면은 만들지 않는다.**
   - 분리 시 시작·폴백 노드의 **범위 밖 연결은 기본적으로 잘라낸다**(TRIM). "따라가기"(FOLLOW)는 선택 옵션. 잘라낸 연결은 **미리보기에 전수 표시**한다.
   - **토픽 도입 전 스냅샷 복원의 노출 위험**: `TOPIC_EXPOSURE_CHANGE` 경고를 보여 주고 **확인 체크박스를 통과해야 복원 버튼이 활성화**된다(architect 원안의 "경고만"보다 강화된 PM 결정 — 기존 `ActiveChatbotAcknowledgeCheckbox` 게이팅 패턴을 그대로 재사용한다, §3.9).
   - **토픽 소속만 변경하면 `updatedAt`은 보존된다** — "최근 수정순" 정렬에 반영되지 않는다. 일괄 지정 확인 대화상자·목록 정렬 드롭다운 근처에 이 사실을 안내한다(§3.4, §9).
   - **비활성화 전 영향 미리보기는 화면 흐름으로 강제**한다 — 미리보기 응답을 받기 전에는 확인 버튼이 비활성이다(§3.2).
   - **분리 상한**: 의도 1,000·예문 20,000·노드 500·FAQ 2,000·키워드 2,000·동음이의어 1,000·컨텍스트 200·설문 50. 초과 시 `422 TOPIC_SPLIT_TOO_LARGE`.
2. **서브내비 8번째 "토픽"**(`AC-C-3` 최상위 라우트 4개 고정과 무충돌 — 대화설계 서브내비만 6→7(No.24 "자주 쓰는 문장")→**8**로 늘어난다). 새 최상위 라우트는 **0개**다.
3. **최상위 `토픽` 메뉴는 만들지 않는다**(P-6). ROCHA 콘솔 상단 내비게이션(`챗봇 | 토픽 | 운영중인 챗봇 | TC테스트 | 통계 | 관리`, 요구사항 §1.2 근거 4)은 "토픽이 챗봇 밖 독립 자원"이라는 해석(b)의 화면이며, 이 그룹은 그 해석을 채택하지 않는다(1차 = 챗봇 안 토픽).
4. **조사 한계 승계**: `docs/00-source/ROCHA_매뉴얼_23.07.07.pdf`(116p)는 이 세션에서도 **페이지를 렌더링하지 못했다**(`pdftoppm is not installed` — `제품소개서_ROCHA.AI.pdf` p.17~18도 같은 오류로 이미지 확인 불가, 요구사항 문서 16행·`hybrid-cs-ui-spec.md` §0.7과 동일한 제약, 이 세션에서 재시도해도 같은 오류). 따라서 이 설계는 **원본 화면의 실제 배치(버튼 위치·모달 형태 등)를 인용하지 않고**, 요구사항 문서가 텍스트로 추출해 둔 근거(§1.2 근거 2 "토픽 상자 위임" 도식 서술, 근거 4 상단 내비 목록, 근거 5 "대화그래프 탭 줄 `⊕ | 기본`")와 이 프로젝트의 선행 화면 관용구(마스터-목록 표, 마법사형 대화상자, `RestoreDialog` 게이팅 패턴)만으로 구성했다. **토픽 생성·챗봇화·병합의 실제 ROCHA 화면 흐름은 여전히 미확인**이다 — 이후 매뉴얼을 확인할 수 있게 되면(`pdftoppm` 설치 또는 다른 렌더 경로) 이 문서의 §3.1(토픽 관리 레이아웃)·§3.7(분리 마법사)을 재검토할 것을 권고한다.
5. **위젯 변경 없음**(`apps/widget` 영향 0 — 공개 계약 한 글자도 바뀌지 않는다, NFR-TPS1). 이 문서에 위젯 섹션이 없다.
6. **병합 화면 없음**: `MESSAGES`·라우트·컴포넌트 어디에도 "병합"이라는 진입점을 만들지 않는다. 분리 마법사 결과 화면에는 "원본 토픽을 비활성화할지" 안내 링크만 있을 뿐, 병합으로 이어지는 UI가 없다(요구사항 §9 범위 밖).

---

## 1. 화면 목록 및 라우트

| ID | 화면명 | 라우트 | 성격 | 진입 경로 | 필요 권한 |
|---|---|---|---|---|---|
| TP0 | **토픽 관리** | `/chatbots/:chatbotId/dialogue/topics` | 페이지(`DialogueShell` 서브내비 8번째) | `DialogueShell` 서브내비 "토픽" | 조회 `dialogue:read` / 쓰기 `dialogue:write` |
| TP-SPLIT | **분리 마법사**(4단계 대화상자) | TP0 내부(신규 라우트 없음) | 모달 | TP0 상단 `[새 챗봇으로 분리]` | `dialogue:read` **AND** `chatbot:write` |
| D1-ext | 대화그래프(노드) 목록 — 토픽 필터·열·배지 확장 | `/chatbots/:chatbotId/dialogue/nodes`(기존) | 페이지 확장 | 기존과 동일 | 조회 `dialogue:read` / 지정 `dialogue:write` |
| D2-ext | 의도·키워드 목록 — 토픽 필터·열·일괄 지정·가져오기 확장 | `/chatbots/:chatbotId/dialogue/intents`(기존) | 페이지 확장 | 기존과 동일 | 〃 |
| D3-ext | 동음이의어 목록 — 토픽 필터·열·일괄 지정 확장 | `/chatbots/:chatbotId/dialogue/homonyms`(기존) | 페이지 확장 | 기존과 동일 | 〃 |
| D4-ext | 컨텍스트 목록 — 토픽 필터·열·일괄 지정 확장 | `/chatbots/:chatbotId/dialogue/contexts`(기존) | 페이지 확장 | 기존과 동일 | 〃 |
| D5-ext | FAQ 목록 — 토픽 필터·열·일괄 지정·내보내기/가져오기 확장 | `/chatbots/:chatbotId/dialogue/faqs`(기존) | 페이지 확장 | 기존과 동일 | 〃 |
| D1-check-ext | 설계 점검 패널 — 토픽 규칙 4종 확장 | D1 내부(`nodes`) | 패널 확장 | D1 "설계 점검" 버튼(기존) | `dialogue:read` |
| SIM-ext | 시뮬레이터 — "비활성 토픽 포함" 토글·답한 자산 토픽 표시 | `/chatbots/:chatbotId/simulator`(기존) | 페이지 확장 | 기존 `TabNav` "시뮬레이터" | 기존 시뮬레이터 권한 불변 |
| VER-ext | 버전 복원 미리보기 — 경고 2종(`TOPIC_MISSING`·`TOPIC_EXPOSURE_CHANGE`) | `/chatbots/:chatbotId/versions`(기존 `RestoreDialog`) | 대화상자 확장 | 기존 "이 버전으로 복원" | 기존 복원 권한 불변 |
| LQ-ext | 미응답 큐 · 증강 제안 — 추천 의도 토픽 배지 | `/chatbots/:chatbotId/learning`(기존) | 페이지 확장 | 기존 `TabNav` "학습현황" | 기존 권한 불변 |

**신규 최상위 라우트는 0개다.** `DialogueShell`의 서브내비가 7→8로 늘어나고(No.24 "자주 쓰는 문장" 선례와 같은 패턴), 나머지는 전부 기존 화면 확장이다. 분리 마법사는 TP0 안의 모달이며 독립 라우트를 갖지 않는다(`CopyChatbotModal`과 같은 원칙 — `chatbot-operations-ui-spec.md` §3.2).

---

## 2. 공통 UI 요소(신규)

### 2.1 배지류 (색상 + 텍스트 병행, UIUX §1)

| 컴포넌트 | 용도 | 규칙 |
|---|---|---|
| `TopicStatusBadge` | TP0 행, 자산 폼의 토픽 선택 옆, 시뮬레이터 결과 | `활성`(회색 텍스트, 배경 없음 — 기본값이라 강조하지 않음) / `비활성`(주황 배경 + 텍스트 "비활성" — **색 점이 아니라 텍스트 배지**, NFR-TPA1) / `공통`(파랑 텍스트, 배경 없음 — 삭제·비활성 불가라는 고정성을 나타내는 자물쇠 아이콘 병기) |
| `TopicNameChip` | 목록 6화면의 "토픽" 열, 노드 목록 배지, 설계 점검 항목 | `{토픽 이름}` 텍스트 + 비활성 토픽이면 "(비활성)" 접미사(색상 단독 아님) · 삭제된 토픽을 가리키는 경우 "(삭제된 토픽)"(EX-TP-24) |
| `CrossTopicRefBadge` | D1 노드 목록 행 | "다른 토픽 참조 {n}"(정보 톤, 회색) — `n=0`이면 렌더하지 않는다(FR-TP4-5) |
| `TopicIssueSeverityIcon` | 설계 점검 패널 | 기존 `SeverityBadge`(오류/주의/안내) 체계를 그대로 쓴다 — 토픽 규칙 전용 아이콘을 새로 만들지 않는다 |
| `LexicalTopicFallbackBadge` | 시뮬레이터 결과 | "토픽: {이름}({활성|비활성})" — 색상 없는 순수 텍스트 |

### 2.2 콘솔 전용 컴포넌트

| 컴포넌트 | props | 규칙 |
|---|---|---|
| `TopicManagementTable` | `items: TopicListItem[]`, `common: { counts, outgoingCrossRefs }`, `loading` | 맨 위 고정 행 "공통"(액션 없음) + 토픽 행(최대 50) — §3.1 상세 |
| `TopicMoveButtons` | `topicId`, `disabled` | 위/아래 버튼(드래그 금지, UIUX §4 — `CannedResponseList`·`ReorderableList` 선례) |
| `TopicForm`(모달) | `value?`, `onSave` | 이름(1~40, 유일) · 설명(≤200, 선택) · 생성 시에만 초기 활성 여부 체크박스(기본 체크) |
| `DeleteTopicConfirmDialog` | `topic`, `counts` | 자산 0건이면 즉시 삭제 확인, 아니면 종류별 건수 + `[공통으로 옮기고 삭제]` 버튼(§3.1) |
| `TopicImpactPreviewDialog` | `topicId`, `action: 'ENABLE'\|'DISABLE'` | §3.2 상세 — **확인 버튼은 미리보기 응답 수신 후에만 활성** |
| `TopicSelectField` | `chatbotId`, `topics: Topic[]`, `value: string\|null`, `onChange`, `disabled?`, `disabledReason?` | 자산 폼(의도/키워드/동음이의어/컨텍스트/노드/FAQ)의 토픽 선택. **`ResourcePickerField`를 재사용하지 않는다** — 토픽은 챗봇당 최대 50개로 화면 진입 시 이미 전량 로드되어 있어 서버 왕복 검색이 필요 없고, "공통"이라는 null 옵션이 chip 제거 은유와 맞지 않는다. 대신 **클라이언트 필터링 콤보박스**(입력하면 이름으로 좁혀지는 `role="listbox"`, 방향키/Enter/Esc — `ResourcePickerField`와 같은 키보드 규약만 재사용)로 새로 만든다. 옵션 20개 초과 대응은 이 타이핑 필터 자체가 UIUX §6 요구("20개 초과 시 셀렉트 대신 다른 UI")를 충족한다. 비활성 토픽은 "{이름}(비활성)"으로 표시하되 선택은 막지 않는다(소속 변경 자체는 허용, 결과 경고는 폼 제출 후 표시) |
| `TopicFilterDropdown` | `topics`, `selected: (string\|'common')[]`, `onChange` | `MultiSelectDropdown` 그대로 재사용(옵션 = "공통" + 토픽 목록, 기존 컴포넌트 변경 0) |
| `BulkTopicAssignModal` | `chatbotId`, `resourceKind`, `selectedIds: string[]`, `topics` | 6개 목록 화면 공용 — §3.4 상세 |
| `TopicSplitWizard`(4단계 모달) | `chatbotId` | §3.7 상세 |
| `TopicExposureAcknowledgeCheckbox` | — | `RestoreDialog`의 `ActiveChatbotAcknowledgeCheckbox`와 **동일한 게이팅 패턴**(미체크 시 확정 버튼 `aria-disabled`) — §3.9 |
| `SystemNodeTopicLockedHint` | — | START/FALLBACK 노드 폼에서 `TopicSelectField` 대신 표시하는 고정 텍스트: "시작·폴백 노드는 항상 공통입니다." |

---

## 3. 화면별 설계

## 3.1 TP0 — 토픽 관리 (`/chatbots/:chatbotId/dialogue/topics`)

### 목적
챗봇 안의 토픽을 만들고, 순서·이름·설명을 바꾸고, 활성/비활성을 전환하고, 자산이 없는 토픽을 삭제하고, 새 챗봇으로 분리하는 진입점.

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5(공통 행 포함 고려) |
| 성공(토픽 0건) | `EmptyState`: "아직 토픽이 없습니다. 토픽으로 대화 자산을 부서·주제별로 나눠 관리할 수 있습니다." + `[+ 토픽 추가]`(공통 행은 토픽이 0건이어도 항상 표시된다 — "가상 토픽") |
| 성공(토픽 1건 이상) | `TopicManagementTable` |
| 상한 도달(50개) | `[+ 토픽 추가]` `aria-disabled` + 툴팁 "챗봇당 토픽은 최대 50개까지 만들 수 있습니다." |
| 오류 | `ErrorState` + 다시 시도 |
| `ARCHIVED` 챗봇 | 기존 `DialogueArchivedBanner` 노출 + 쓰기 액션(추가/편집/전환/삭제/분리 실행) 전부 비활성 — **분리 미리보기(읽기)는 예외적으로 활성**(FR-TP6-1, EX-TP-17) |

### 레이아웃

```
┌───────────────────────────────────────────────────────────────────────────┐
│ 대화설계 > 토픽                                     토픽 2/50  [+ 토픽 추가]│
├───────────────────────────────────────────────────────────────────────────┤
│ 이름         상태     의도 키워드 동음 컨텍스트 노드 FAQ  참조(나감/들어옴) │
│ 공통          공통     40   120    8     5       30   60      —   / 12    │
│ 배송          활성     12    34    2     3       15   20      3   / 5   ▲▼│
│              편집  비활성화  삭제                                          │
│ 보험청구      비활성   8     10    1     2        6    9      1   / 0   ▲▼│
│              편집  활성화   삭제                                          │
├───────────────────────────────────────────────────────────────────────────┤
│                                            [새 챗봇으로 분리 →]            │
└───────────────────────────────────────────────────────────────────────────┘
```

- 공통 행은 **항상 맨 위 고정**이며 위/아래·편집·전환·삭제 액션이 없다(FR-TP1-3).
- "참조(나감/들어옴)"은 `TP1-4`의 교차 참조 수 — 클릭하면 §3.5 설계 점검 패널로 이동(해당 토픽 규칙 필터가 걸린 상태).
- 상태 열은 `TopicStatusBadge`(활성/비활성)만 표시한다 — 색 점을 보조로 병기해도 되지만(NFR-TPA1 "색 점은 보조") 텍스트가 항상 주된 구분자다.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `TopicManagementTable` | `GET /chatbots/:chatbotId/topics` → `TopicListResponse`(items + common + limit 50) — 쿼리 8회 고정(NFR-TPP2) |
| `TopicMoveButtons` | `POST …/topics/:topicId/move { direction }` → 응답 전체 목록으로 즉시 재렌더, 포커스는 이동한 버튼에 유지 |
| `TopicForm`(생성/편집 모달) | `POST …/topics` / `PATCH …/topics/:topicId` — §3.1.1 필드-오류 매핑 |
| `TopicStatusToggleButton` | 클릭 → `TopicImpactPreviewDialog` 오픈(§3.2). 전환 자체는 그 대화상자의 확인 버튼이 실행 |
| `DeleteTopicConfirmDialog` | 클릭 → 자산 수 0이면 `ConfirmDialog(danger=true)` 즉시 · 아니면 §3.1.2 |
| `TopicSplitWizard` 진입 버튼 | `[새 챗봇으로 분리 →]` — §3.7 |

### 3.1.1 `TopicForm` 필드-오류 매핑

| field/code | 위치 | 메시지 |
|---|---|---|
| `name`(1~40자) | 이름 필드 하단 | "이름은 1~40자로 입력해 주세요." |
| `name`(중복, `409 DUPLICATE_NAME`) | 이름 필드 하단 | "이미 같은 이름의 토픽이 있습니다." |
| `description`(≤200자) | 설명 필드 하단 | "설명은 200자 이내로 입력해 주세요." |
| 51번째 생성(`409 LIMIT_EXCEEDED`) | 폼 상단 배너 | "챗봇당 토픽은 최대 50개까지 만들 수 있습니다." |
| `CHATBOT_ARCHIVED` | 폼 상단 배너 | "보관된 챗봇입니다." |

### 3.1.2 삭제 대화상자(`DeleteTopicConfirmDialog`)

```
┌ '보험청구' 삭제 ───────────────────────────────────────────── ✕ ┐
│ 이 토픽에는 자산이 있어 바로 삭제할 수 없습니다.                  │
│   의도 8 · 키워드 10 · 동음이의어 1 · 컨텍스트 2 · 노드 6 · FAQ 9 │
│                                                                  │
│ 자산을 모두 '공통'으로 옮긴 뒤 삭제하시겠습니까?                   │
│                                                                  │
│                                    [취소]  [공통으로 옮기고 삭제] │
└──────────────────────────────────────────────────────────────┘
```

- 서버: `DELETE …/topics/:topicId?moveToCommon=true` → 한 트랜잭션(일괄 소속 해제 → 삭제) → 성공 시 `Toast`("토픽이 삭제되고 자산 {n}건이 공통으로 이동했습니다.") + 목록 재조회(AC-TP1-4).
- 경합(삭제 확인 표시 이후 다른 사용자가 자산을 추가)으로 `409 TOPIC_NOT_EMPTY`가 다시 오면 대화상자를 닫지 않고 건수를 최신값으로 갱신 + 안내 "자산이 늘어났습니다. 다시 확인해 주세요."

---

## 3.2 활성/비활성 전환 — 영향 미리보기 대화상자 (`TopicImpactPreviewDialog`, FR-TP3-3)

### 목적
토픽을 끄거나 켜기 전에 무엇이 끊기는지 반드시 보여 준다. **서버가 증빙을 요구하지는 않지만, 이 화면은 미리보기를 받기 전까지 확인 버튼을 내주지 않는 방식으로 "필수"를 구현한다**(architect 확정 D-7).

### 진입
TP0 행의 "비활성화"/"활성화" 버튼 클릭 → **오픈 즉시** `GET …/topics/:topicId/impact?action=DISABLE|ENABLE` 자동 호출(사용자가 별도 "미리보기" 버튼을 누르지 않는다 — `RestoreDialog` L4와 동일한 "진입 = 미리보기 요청" 원칙).

### 상태별 UI

| 상태 | UI |
|---|---|
| 미리보기 로딩 | 다이얼로그 내부 `Skeleton` — "영향을 확인하는 중…"(`aria-live="polite"`) |
| 미리보기 완료, 이미 그 상태(`alreadyInState:true`) | "이미 {활성\|비활성} 상태입니다." + `[닫기]`만(전환 버튼 없음) |
| 미리보기 완료(일반) | §3.2.1 레이아웃 — **확인 버튼 활성** |
| 미리보기 오류 | 다이얼로그 내부 `ErrorState` + 다시 시도(확인 버튼은 계속 비활성) |
| 전환 진행 중 | 확인 버튼 스피너 + `disabled`(연타 방지) |
| 전환 성공 | 다이얼로그 닫힘 + `Toast`("'{토픽명}'이(가) {활성화\|비활성화}되었습니다.") + TP0 목록 갱신 + `AC-TP3-7` 같은 인스턴스는 다음 요청부터 즉시 반영 |
| 전환 실패(`409 CHATBOT_ARCHIVED`) | 배너 "보관된 챗봇입니다." |

### 3.2.1 레이아웃 — 비활성화(DISABLE) 예시

```
┌ '보험청구' 비활성화 ──────────────────────────────────────── ✕ ┐
│ 노드 6 · 의도 8 · FAQ 9가 운영 응답에서 빠집니다.                │
│ (키워드·컨텍스트·동음이의어는 그대로 유지됩니다 — 사전형 자산)    │
│                                                                 │
│ ⚠ 끊기는 참조 (12건 중 상위 20건)                                │
│  출발              토픽    간선       도착              토픽     │
│  배송조회_응답      배송    이동 →     보험접수_안내      보험청구│
│  [편집]                                                [편집]   │
│  ⋮ (스크롤)                                                     │
│                                                                 │
│ 비활성화 후 이 토픽의 활성 진입점 수: 0건                        │
│ ⓘ 전환 후 대화설계 > 대화그래프에서 "활성 응답 진입점 0건" 경고가│
│    표시됩니다.                                                  │
│                                                                 │
│ ⚠ 대기 중인 복원 예약 1건이 있습니다 — 이 전환은 예약에 영향을    │
│    주지 않습니다(예약 해시는 소속 변경 때만 바뀝니다).            │
│                                                                 │
│ 다중 인스턴스 환경에서는 다른 서버에 최대 60초 뒤 반영됩니다.     │
│                                                                 │
│                                        [취소]      [비활성화]   │
└─────────────────────────────────────────────────────────────┘
```

- 활성화(ENABLE) 시: "끊기는 참조" 대신 **여전히 끊긴 채로 남는 참조**(다른 비활성 토픽을 향함)와 **활성 토픽과 겹치는 예문 수**(상위 20 + 총수)를 보여 준다.
- "끊기는 참조" 표의 각 행은 출발·도착 리소스 편집 화면으로 바로가기(href 기반, UIUX §9).
- 항목이 20건을 넘으면 "외 {total-20}건"으로 잘림 표시(EX-TP-23).
- **확인 버튼은 미리보기 응답을 받은 뒤에만 활성**이며, `aria-disabled` 상태에서 이유를 `aria-describedby`로 연결한다(스크린리더가 "비활성화됨, 영향을 확인하는 중"으로 읽도록).
- 포커스 트랩 + 기본 포커스는 "취소"(`RestoreDialog` NFR-HA2 원칙 상속).

---

## 3.3 목록 6화면 확장 — 공통 패턴 (FR-TP2-\*)

D1(노드)·D2(의도/키워드)·D3(동음이의어)·D4(컨텍스트)·D5(FAQ) 5개 페이지(의도·키워드는 클라이언트 서브탭 1페이지)에 아래를 **동일한 패턴**으로 추가한다.

### 공통 추가 요소

| 요소 | 배치 | 규칙 |
|---|---|---|
| `TopicFilterDropdown` | 기존 필터 바 오른쪽(또는 줄바꿈) | 옵션 = "전체"(기본) + "공통" + 토픽 목록(활성/비활성 구분 없이 전부, 비활성은 "{이름}(비활성)") · URL 쿼리 `topicIds=common,<uuid>,…`로 유지(FR-TP2-4) · 삭제된 토픽 id가 쿼리에 남아 있으면 `TopicNameChip`으로 "삭제된 토픽" 칩을 필터 바에 표시하고 매칭 결과는 0건(EX-TP-24) |
| "토픽" 열 | 기존 표의 마지막 열 부근 | `TopicNameChip`(공통이면 "공통" 텍스트) |
| 행 선택 체크박스 열 | 표 맨 앞(기존 일괄삭제용 체크박스가 있는 화면은 그대로 공유) | 선택 시 상단에 `[선택한 {n}건 토픽 지정]` 버튼 노출 |
| `BulkTopicAssignModal` | 선택 후 버튼 클릭 | §3.4 상세 |
| 정렬 드롭다운의 "최근 수정순" 옵션 | 기존 정렬 셀렉트 | 옵션 라벨 옆에 도움말 아이콘: "토픽 소속만 바꾼 항목은 이 정렬에 반영되지 않습니다(내용이 바뀌지 않았기 때문입니다)." |

### 화면별 특이사항

| 화면 | 추가 사항 |
|---|---|
| D1(노드) | `CrossTopicRefBadge`("다른 토픽 참조 {n}") — 행마다(FR-TP4-5). START/FALLBACK 행은 토픽 열에 "공통"(자물쇠 아이콘, 변경 불가) |
| D2(의도/키워드) | 예문 교차 충돌 경고에 상대 의도의 토픽 이름 추가(§3.1 하단 예시), 동의어 충돌 오류에 상대 키워드 토픽 이름 추가(둘 다 §3.6 오류 매핑에서 다룸). 내보내기/가져오기 확장은 §3.6 |
| D3(동음이의어) | 변경 없음(교차 참조는 설계 점검 패널에서만 표시, E-7) |
| D4(컨텍스트) | 변경 없음 |
| D5(FAQ) | 내보내기/가져오기 확장은 §3.6 |

### 자산 폼(생성/수정) 공통 확장

- 6종 폼 모두 `TopicSelectField`(§2.2)를 추가한다. **기본값 = 현재 목록 필터에서 선택 중인 단일 토픽**(필터가 "전체"거나 다중 선택이면 공통).
- 노드 폼: 유형이 START 또는 FALLBACK이면 `TopicSelectField` 대신 `SystemNodeTopicLockedHint`를 렌더한다(생성·수정·유형 변경 전환 모두 — `400 TOPIC_SYSTEM_NODE_LOCKED`가 오면 같은 문구를 인라인 오류로도 표시).
- 다른 챗봇/없는 토픽을 가리키면(경합) `404 INVALID_REFERENCE` → `TopicSelectField` 하단 인라인 오류 "선택한 토픽을 찾을 수 없습니다. 새로고침해 주세요."

---

## 3.4 일괄 토픽 지정 (`BulkTopicAssignModal`, FR-TP2-5)

### 진입
목록에서 자산을 체크(최대 1,000건) → 상단 `[선택한 {n}건 토픽 지정]` → 모달 오픈.

### 레이아웃

```
┌ 토픽 지정 — 의도 42건 ───────────────────────────────────── ✕ ┐
│ 대상 토픽  [배송 ▾]                                            │
│                                                                │
│ ⚠ '배송'은 비활성 토픽입니다 — 옮기면 노드 5 · 의도 9 · FAQ 0이 │
│    운영 응답에서 즉시 빠집니다.                                 │
│                                                                │
│ ⓘ 소속만 바뀌며 예문·내용은 그대로입니다. '최근 수정순'에는     │
│    반영되지 않습니다.                                          │
│                                                                │
│ ⚠ 대기 중인 복원 예약 1건이 있습니다 — 이 지정은 그 예약을      │
│    보류시킬 수 있습니다(소속 변경은 버전 해시를 바꿉니다).       │
│                                                                │
│                                          [취소]     [지정]     │
└──────────────────────────────────────────────────────────────┘
```

- 대상 토픽 선택은 `TopicSelectField`(공통 포함).
- **비활성 토픽으로 옮기는 경우 경고 문구**(FR-TP2-7) — 건수는 **선택한 행 중 실제 노드/의도/FAQ 종류의 수**를 클라이언트가 계산(서버 추가 조회 0, 설계서 §5.2 근거).
- **대기 중 복원 예약 고지**(EX-TP-15)는 기존 `GET …/deploy-schedules/notice` 배너를 그대로 호출해 얻는다(새 API 0). 예약이 없으면 이 줄은 렌더하지 않는다.
- 노드를 대상으로 하고 선택 안에 START/FALLBACK이 있으면 제출 전 클라이언트가 걸러 안내: "시작·폴백 노드는 토픽을 지정할 수 없어 이번 지정에서 제외됩니다({n}건)." (서버도 `400 TOPIC_SYSTEM_NODE_LOCKED`로 같은 것을 막는다 — 이중 방어)

### 상태별 UI

| 상태 | UI |
|---|---|
| 제출 중 | 버튼 스피너 + `disabled` |
| 성공 | 모달 닫힘 + `Toast`("{n}건이 '{토픽명}'(으)로 지정되었습니다.") + 목록 갱신, `aria-live="polite"`로 1회 결과 안내 |
| 부분 실패(누락 id, `404 INVALID_REFERENCE`) | 모달 유지 + 배너 "선택한 항목 중 {n}건이 이미 삭제되어 지정할 수 없습니다(0건 반영됨). 목록을 새로고침해 주세요." (전체 롤백 — 부분 성공 없음, EX-TP-13) |
| 1,001건 초과(`400 VALIDATION_FAILED`) | 진입 전 클라이언트가 이미 선택 상한 1,000건으로 체크박스를 막는다(방어적 UI) — 경합 시 배너로 동일 문구 |

---

## 3.5 설계 점검 패널 확장 (D1 `DesignValidationPanel`, FR-TP4-\*)

기존 `DesignValidationPanel`(`dialogue-design-ui-spec.md` §4.1.2)에 No.26·No.27이 그랬듯 **같은 `DesignIssueRow` 형식**으로 토픽 규칙 4종을 추가한다.

```
┌ 설계 점검 결과 (2026-09-25 10:02 기준)                              [닫기] ┐
│ 오류 1건  주의 5건  안내 4건                                                │
├──────────────────────────────────────────────────────────────────────────┤
│ ✖ 오류   존재하지 않는 의도를 참조하는 노드            [배송조회_응답 편집]│
│ ⚠ 주의   비활성 토픽 참조 — 배송조회_응답(배송) → 보험접수_안내(보험청구·  │
│          비활성)                                       [배송조회_응답 편집]│
│ ⚠ 주의   토픽 '보험청구'에 활성 응답 진입점이 없습니다              [토픽 관리로 이동]│
│ ⓘ 안내   교차 토픽 참조 — 공통 노드 → 환불 의도 조건                [노드 편집]│
│ ⓘ 안내   토픽 간 예문 중복 — 배송 '택배 언제 와' ↔ 환불 '택배 언제 와' [의도1 편집][의도2 편집]│
└──────────────────────────────────────────────────────────────────────────┘
```

| 코드 | 심각도 | 메시지 패턴 |
|---|---|---|
| `INACTIVE_TOPIC_REFERENCE` | 주의(⚠) | "비활성 토픽 참조 — {출발}({출발토픽}) → {도착}({도착토픽}·비활성)" |
| `CROSS_TOPIC_REFERENCE` | 안내(ⓘ) | "교차 토픽 참조 — {출발토픽} {출발} → {도착토픽} {도착}" |
| `CROSS_TOPIC_DUPLICATE_EXAMPLE` | 안내(ⓘ) | "토픽 간 예문 중복 — {토픽A} '{의도A}' ↔ {토픽B} '{의도B}'" — 상대 이름은 §3.3 D2의 예문 교차 충돌 경고와 같은 문구 규칙 |
| `NO_LIVE_ENTRY_POINT` | 주의(⚠) | "토픽이 있지만 활성 응답 진입점이 0건입니다" — 대상이 `CHATBOT`이면 "[토픽 관리로 이동]"으로 바로가기(개별 리소스 편집 링크가 없다) |

- 토픽이 0개인 챗봇은 이 4종 규칙 결과가 **항상 빈 배열**이라 패널이 도입 전과 바이트 동일하게 보인다(AC-TP4-4) — 별도 UI 분기 필요 없음.
- 항목이 규칙별 50건을 넘으면 "외 {ruleTotals[code]-50}건" 표시(EX-TP-23).
- **[No.26]**·**[No.27]** 각주와 같은 위치에 **[No.22]** 각주를 추가: "토픽 관련 신규 진단 코드 4종은 `topic-system-ui-spec.md` §3.5를 참고."

---

## 3.6 토픽 단위 내보내기/가져오기 (D2·D5, FR-TP5-\*)

### 관계 정리 (기존 벌크 임포트 vs 이 그룹)

- **내보내기·가져오기(이 절)**: 이름 기준 병합, ID를 다루지 않는다. 파일 형식은 **바꾸지 않는다**(토픽 열 없음 — 다른 챗봇·기존 템플릿과 호환, FR-TP5-1).
- **분리(§3.7)**: ID 재매핑. 서로 다른 문제를 푼다 — 화면에서도 진입점이 다르다(D2/D5 내보내기 버튼 vs TP0 "새 챗봇으로 분리").
- **노드·컨텍스트·동음이의어는 이 절 대상이 아니다**(FR-TP5-3) — 이 3종은 애초에 파일 내보내기/가져오기 UI 자체가 없다(참조 ID를 담고 있어 파일 이관이 성립하지 않는다). 이 3종의 화면(D1/D3/D4)에는 §3.3의 필터·열·일괄 지정만 있고 §3.6은 적용되지 않는다.

### 내보내기 확장

- 기존 "내보내기" 버튼(D2·D5)은 **현재 필터를 그대로 따른다** — 새 UI 요소를 만들지 않는다. 버튼 옆에 도움말 아이콘: "지금 적용된 토픽 필터가 내보내기 파일에도 적용됩니다."(P-6/§20 안내)

### 가져오기 확장 (`BulkImportModal` 2단계 "반영하기" 직전)

```
… 기존 리포트(신규/갱신/중복/오류/충돌) …
신규 항목의 토픽  [공통 ▾]
ⓘ 이름이 같은 기존 항목은 토픽을 바꾸지 않고 값만 합쳐집니다.
                                                    [취소]  [반영하기]
```

- `TopicSelectField`(기본 = 공통) 1개 추가 → 커밋 요청에 `newItemTopicId` 포함.
- **새로 생기는 항목만** 선택한 토픽에 들어가고, 기존 항목은 토픽을 바꾸지 않는다(AC-TP2-4) — 이 사실을 도움말로 상시 노출한다.

---

## 3.7 분리 마법사 (`TopicSplitWizard`, TP0 진입, FR-TP6-\*)

### 목적
선택한 토픽(들)을 **새 챗봇으로 복사**한다. 원본은 절대 바뀌지 않는다.

### 단계 구조

```
① 토픽 선택 → ② 미리보기 → ③ 이름·slug·그룹 → ④ 결과
```

각 단계 상단에 진행 표시 "{n}/4단계"를 텍스트로 노출한다(UIUX §4 "n/N 진행 표시" 원칙을 관리자 마법사에도 준용 — 설문 위젯 선례와 같은 패턴, §7 근거). 뒤로가기 버튼으로 이전 단계 값을 유지한 채 돌아갈 수 있다(②→① 되돌아가면 미리보기는 버려지고 ①에서 값을 바꾼 뒤 다시 계산).

### 3.7.1 단계 ① — 토픽 선택

```
┌ 새 챗봇으로 분리 (1/4) ───────────────────────────────────── ✕ ┐
│ 분리할 토픽을 선택하세요.                                        │
│ ☑ 배송(활성, 자산 84)   ☐ 보험청구(비활성, 자산 36)              │
│ ☐ 공통 자산도 포함(전체 자산이 공통에 포함되면 사실상 챗봇 전체를 │
│    복사합니다 — "깊은 복사")                                    │
│                                                                 │
│ 시작·폴백 노드의 범위 밖 연결 처리                                │
│  ⦿ 잘라내기(권장) — 선택 밖을 가리키는 이동·버튼만 제거합니다.   │
│  ○ 함께 복사 — 시작·폴백 노드가 참조하는 모든 자산을 함께 가져옵니다.│
│                                                                 │
│                                                    [취소] [다음] │
└──────────────────────────────────────────────────────────────┘
```

- 토픽 0개 선택 + "공통 포함" 미체크 시 `[다음]` `aria-disabled` + 도움말 "토픽을 1개 이상 선택하거나 공통 자산을 포함해 주세요."
- 연결 처리 라디오는 **"공통 포함"을 체크하면 렌더하지 않는다**(§9.3 규칙 — 공통 선택 시 시스템 노드도 정상 폐포를 따라간다).

### 3.7.2 단계 ② — 미리보기 (`POST …/topics/split/preview`, DB 변경 0)

```
┌ 새 챗봇으로 분리 (2/4) ───────────────────────────────────── ✕ ┐
│ 선택한 토픽 자산    의도 8 · 키워드 4 · 동음 1 · 컨텍스트 0 · 노드│
│                     10 · FAQ 30                                │
│ 함께 복사되는 자산(토픽 밖 참조, 새 챗봇에서 '공통') 7건          │
│  [목록 펼치기 ▾]                                                │
│ ⚠ 함께 복사되는 자산이 선택한 자산보다 많습니다. 원본에서 참조를  │
│    정리하면 더 작은 결과를 얻을 수 있습니다.  (closureDominates) │
│ 시작·폴백 노드 포함: 시작 ✓ · 폴백 ✓                             │
│                                                                 │
│ 잘라낼 연결 3건(전수)                                            │
│  시작 → [메뉴_배송] 버튼          대상: 배송조회_응답(배송, 유지)│
│  시작 → [메뉴_보험] 버튼          대상: 보험접수_안내(보험청구, 제외됨)│
│  ⋮                                                              │
│ 따라간 API/설문 분기: 0건                                        │
│                                                                 │
│ 설문 복제: 0건 · API 연결 유지: 1건                              │
│ 복사하지 않는 항목: 채널·답변설정·상담설정·자주 쓰는 문장·TC·미응답│
│   큐·증강 제안·분류기·대화이력·버전·예약·임베딩 벡터·설문 응답    │
│                                                                 │
│ 예상 규모: 의도 15/1,000 · 노드 12/500 · FAQ 30/2,000 (모두 상한 이내)│
│                                                                 │
│                                            [이전]  [다음]        │
└──────────────────────────────────────────────────────────────┘
```

- `exceeded[]`(상한 초과 종류)가 있으면 해당 행을 굵게 + 빨강 텍스트("상한 초과") + `[다음]` `aria-disabled`. 예: "키워드 2,340/2,000 — 상한 초과". 문구: "선택 범위가 너무 큽니다. 토픽을 나누어 다시 시도해 주세요."
- "잘라낼 연결" 표는 §9.3 규칙에 따라 **항상 전수 표시**(조용히 지우지 않는다) — 상위 50 + 총수, `frontend-implementer`는 50건 초과 시 "외 {n}건" 처리.
- `closureDominates:true`면 경고 문구를 강조(EX-TP-19).

### 3.7.3 단계 ③ — 이름·slug·그룹

`chatbot-operations-ui-spec.md`의 `CopyChatbotModal` 필드를 그대로 재사용한다(새 컴포넌트를 만들지 않는다).

```
┌ 새 챗봇으로 분리 (3/4) ───────────────────────────────────── ✕ ┐
│ 이름  [쇼핑몰 도우미 (분리)_______________]                     │
│ slug  [shopping-bot-split___________] (자동 파생, 수정 가능)    │
│ 그룹  [원본과 동일 ▾]                                           │
│ ⓘ 새 챗봇은 초안(DRAFT) 상태로 생성되며 채널은 열리지 않습니다.  │
│                                                    [이전] [분리 실행]│
└──────────────────────────────────────────────────────────────┘
```

- slug 중복은 제출 시 `409 DUPLICATE_SLUG` → slug 필드 하단 인라인 "이미 사용 중인 주소입니다."
- 보관 그룹 선택은 서버가 `404`로 막는다(기존 `copy()` 규칙 그대로) → 그룹 필드 하단 "보관된 그룹은 선택할 수 없습니다."

### 3.7.4 단계 ④ — 결과 (`POST …/topics/split`)

| 상태 | UI |
|---|---|
| 실행 중 | `[분리 실행]` 스피너 + `disabled`, 모달 `Esc`/배경 클릭 비활성(진행 중 이탈 방지 — `RestoreDialog` 확정 진행 패턴과 동일) |
| 성공(`201`) | §3.7.4.1 결과 레이아웃 |
| 실패(`422 TOPIC_SPLIT_TOO_LARGE`) | 단계 ②로 자동 복귀 + 배너(재확인 흐름 — 경합으로 미리보기 이후 자산이 늘어난 경우) |
| 실패(`409 TOPIC_SPLIT_BUSY`) | 모달 유지 + 배너 "지금 다른 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요." + `[다시 시도]`(같은 입력 재전송) |
| 실패(`409 DUPLICATE_SLUG`) | 단계 ③으로 복귀 + slug 인라인 오류 |
| 실패(`404`, 보관 그룹/토픽 경합) | 단계 ③ 또는 ①로 복귀(대상에 맞게) + 배너 |

#### 3.7.4.1 결과 레이아웃

```
┌ 분리 완료 ───────────────────────────────────────────────── ✕ ┐
│ ✔ '쇼핑몰 도우미 (분리)'가 생성되었습니다.                       │
│   의도 15 · 키워드 6 · 동음 1 · 컨텍스트 1 · 노드 12 · FAQ 30    │
│   (동반 복사 7건 포함) · 잘라낸 연결 1건 · 설문 복제 0건          │
│   캡처 시각: 2026-09-25 10:12                                   │
│                                                                 │
│ 새 챗봇 설계 점검: 오류 0 · 주의 1 · 안내 0  [자세히 보기 →]     │
│ ⏳ 의미 매칭 색인을 만드는 중입니다(완료 전까지 규칙 매칭만 동작).│
│                                                                 │
│ 복사되지 않은 항목: 채널·답변설정·상담설정·자주 쓰는 문장·TC·미응답│
│   큐·증강 제안·분류기·대화이력·버전 이력·예약·임베딩 벡터·설문 응답│
│                                                                 │
│ ⓘ 원본 챗봇의 '배송' 토픽을 비활성화하려면? [토픽 관리로 이동]    │
│                                                                 │
│                                        [새 챗봇으로 이동 →] [닫기]│
└──────────────────────────────────────────────────────────────┘
```

- `[새 챗봇으로 이동]` → `/chatbots/:newChatbotId`(대시보드).
- "원본 토픽 비활성화" 링크는 **안내일 뿐 자동 실행하지 않는다**(FR-TP6-12) — 클릭하면 원본 챗봇 TP0로 이동.
- 실패 시(적재 중 예외) 새 챗봇 행까지 전부 롤백되므로(AC-TP5-5) 이 결과 화면 자체가 렌더되지 않고 §표의 실패 행동으로 처리된다.

### 3.7.5 필드-오류 매핑

| field/code | 위치 | 메시지 |
|---|---|---|
| 토픽 0개 + 공통 미포함 | 단계① `[다음]` 비활성 | "토픽을 1개 이상 선택하거나 공통 자산을 포함해 주세요." |
| `exceeded[]` | 단계② 해당 종류 행 | "선택 범위가 너무 큽니다. 토픽을 나누어 다시 시도해 주세요." |
| `slug` 중복 | 단계③ slug 필드 | "이미 사용 중인 주소입니다." |
| 보관 그룹(`404`) | 단계③ 그룹 필드 | "보관된 그룹은 선택할 수 없습니다." |
| `409 TOPIC_SPLIT_BUSY` | 단계④ 상단 배너 | "지금 다른 처리가 진행 중입니다. 잠시 후 다시 시도해 주세요." |
| `403`(권한 부족) | TP0 진입 시 버튼 자체 숨김 | — (§4) |

---

## 3.8 시뮬레이터 확장 (`/chatbots/:chatbotId/simulator`, FR-TP3-7)

```
┌ 시뮬레이터 ──────────────────────────────────────────────────────┐
│ ☐ 비활성 토픽 포함                                                │
│ [입력창_______________________________________________] [전송]   │
├────────────────────────────────────────────────────────────────┤
│ 사용자  택배 계좌를 알려줘                                        │
│ 챗봇    보험 접수는 이렇게 진행합니다…                             │
│         토픽: 보험청구(비활성)                                    │
└────────────────────────────────────────────────────────────────┘
```

- 토글 기본값 **꺼짐**(운영과 동일 — FR-TP3-7). 켜면 요청에 `includeInactiveTopics: true` 포함 → 서버가 별도 비필터 캐시(`getCachedUnfiltered`)로 응답한다 — **운영 캐시는 오염되지 않는다**(AC-TP3-6, 이 요청 이후 공개 대화를 시험해도 여전히 폴백).
- 결과 trace·비교(compare) 패널 모두에 답한 자산의 `answeredTopic`이 있으면 `LexicalTopicFallbackBadge`("토픽: {이름}({활성|비활성})")를 노출한다. 없으면(공통 또는 미응답) 아무것도 표시하지 않는다.
- TC 실행에는 이 토글이 없다(EX-TP-20) — 시뮬레이터 화면에만 존재한다는 점을 토글 근처 도움말로 명시: "TC 실행에는 이 옵션이 없습니다. 비활성 토픽 대상 TC는 실패로 보고됩니다."

---

## 3.9 버전 복원 미리보기 확장 (`RestoreDialog`, FR-TP8-4/5)

`version-history-ui-spec.md` §4.4의 `RestoreWarningList`(기존 11종)에 **2종을 추가**한다. `TOPIC_EXPOSURE_CHANGE`는 `ACTIVE_CHATBOT`과 같은 **체크박스 게이팅 패턴**을 쓴다(PM이 architect 원안 "경고만"보다 강화 — 확인 체크 필수).

| `code` | 문구 | 체크박스 |
|---|---|---|
| `TOPIC_MISSING` | "대상 버전이 가리키는 토픽 중 {count}건이 지금은 없습니다 — 해당 자산은 복원 후 '공통'이 됩니다." | 없음(정보) |
| `TOPIC_EXPOSURE_CHANGE` | "복원하면 준비 중(비활성) 토픽의 자산 {exposed}건이 운영에 노출되고, {hidden}건이 운영에서 숨겨집니다." | **있음** — `TopicExposureAcknowledgeCheckbox` |

### 레이아웃 (기존 §4.4.1에 삽입되는 부분만)

```
│ ⚠ 경고                                                                 │
│  · 운영 중인 챗봇입니다 — 복원하면 다음 대화부터 즉시 반영됩니다.        │
│  · 대상 버전이 가리키는 토픽 중 2건이 지금은 없습니다 — 공통이 됩니다.   │
│  · 복원하면 준비 중 토픽의 자산 18건이 운영에 노출되고, 3건이 숨겨집니다.│
│                                                                        │
│ ☐ 이 챗봇은 현재 운영 중입니다. 복원하면 다음 대화부터 즉시 반영됩니다.  │
│ ☐ 준비 중이던 자산 18건이 운영에 노출된다는 점을 확인했습니다.           │
│    계속하려면 두 확인을 모두 체크해 주세요.                              │
│                                          [취소]      [v14로 복원]      │
```

- `exposed`·`hidden`이 **둘 다 0이면 경고 자체를 렌더하지 않는다**(기존 미리보기 응답 바이트 동일, §11.3 설계 근거) — 체크박스도 당연히 없다.
- `ACTIVE_CHATBOT`과 `TOPIC_EXPOSURE_CHANGE` 체크박스가 **둘 다 있으면 둘 다 체크해야** 확정 버튼이 활성화된다(`aria-disabled` 해제 조건 = 렌더된 모든 게이팅 체크박스 체크 완료).
- **백엔드 인계 메모**: 이 체크박스는 확정 요청 바디에 `acknowledgeTopicExposure: boolean` 필드가 필요하다(기존 `acknowledgeActive`와 나란히). 이 필드는 `docs/02-spec/topic-system-설계.md` §11이 작성된 시점에는 없었다(architect 원안은 경고만) — PM이 오늘(2026-09-25) 확인 체크로 강화했으므로 backend-implementer는 `POST …/restore` 요청 스키마에 이 필드를 추가해야 한다(§10 인계 메모에 재기재).

---

## 3.10 미응답 큐 · 증강 제안 — 추천 의도 토픽 표시 (`/chatbots/:chatbotId/learning`, FR-TP8-6)

- 미응답 큐의 "추천 의도" 배지 목록(기존 `learning-augmentation-ui-spec.md` 대상 컴포넌트)에 `TopicNameChip`을 추가한다: "환불_문의(보험청구·비활성)".
- **비활성 토픽 의도를 추천에서 빼지 않는다** — 준비 중 토픽에 예문을 보태는 것은 정당한 운영이다(FR-TP8-6). 대신 배지로 "비활성"임을 보여 사용자가 판단하게 한다.
- 증강 제안 화면(제안 컨테이너, UIUX §1 "제안-자산 시각적 분리" 패턴 상속)에서도 대상 의도 상세의 토픽을 같은 방식으로 표시한다(의도 상세 API가 이미 `topicId`를 돌려준다 — 콘솔이 토픽 목록으로 이름 해석).

---

## 4. 권한별 UI 변화 규칙

원칙(F-4 상속): **권한이 없는 화면·버튼은 렌더 자체를 하지 않는다.** "지금 상태라서" 못 하는 동작만 버튼을 남기고 사유와 함께 비활성화한다.

| 화면/동작 | VIEWER | EDITOR | AGENT | ADMIN |
|---|---|---|---|---|
| `DialogueShell` 서브내비 "토픽" 진입 | 조회 가능(`dialogue:read`) | 조회·편집 가능 | **접근 불가**(`dialogue:read` 없음 — 기존 대화설계 서브내비 전부와 동일) | 조회·편집 가능 |
| TP0 토픽 생성·수정·순서·전환·삭제 | 버튼 자체 없음(조회만) | 가능 | — | 가능 |
| TP0 "새 챗봇으로 분리" 버튼 | 숨김(`chatbot:write` 없음) | 가능(`dialogue:read`+`chatbot:write` 있으면) | — | 가능 |
| 목록 6화면 토픽 필터·열 | 조회 가능 | 조회 가능 | 접근 불가(화면 자체) | 조회 가능 |
| 목록 6화면 일괄 지정·자산 폼 토픽 선택 | 버튼/필드 없음 | 가능 | — | 가능 |
| 설계 점검 토픽 규칙 결과 | 조회 가능 | 조회 가능 | 접근 불가 | 조회 가능 |
| 시뮬레이터 "비활성 토픽 포함" 토글 | 기존 시뮬레이터 권한 그대로 | 〃 | 〃(대화설계 화면이 아니므로 시뮬레이터 자체 권한을 따른다) | 〃 |
| 버전 복원 경고 2종·체크박스 | 기존 복원 권한 그대로(조회는 `dialogue:read`, 확정은 기존 복원 권한) | 〃 | 〃 | 〃 |
| 미응답 큐 토픽 배지 | 기존 학습현황 권한 그대로 | 〃 | 〃 | 〃 |

- `ARCHIVED` 챗봇: 토픽 조회·영향 미리보기·**분리(원본 읽기)**는 허용, 토픽 쓰기·소속 지정은 버튼이 남되 비활성 + 사유("보관된 챗봇입니다")(EX-TP-17).
- 이 표는 대표 지점 발췌다 — 전 화면 매트릭스는 설계서 §14 표가 최종 근거다.

---

## 5. 사용자 인터랙션 흐름 (제출 → 로딩 → 결과, 오류 포함)

### 5.1 토픽 생성 → 자산 분류 → 비활성화 → 재활성화 (핵심 흐름)

1. TP0 진입 → `[+ 토픽 추가]` → `TopicForm`("보험청구", 초기 활성) → 저장(`201`) → 목록에 즉시 추가.
2. D2(의도·키워드)로 이동 → 관련 의도 8건 체크 → `[선택한 8건 토픽 지정]` → `BulkTopicAssignModal`(대상 = 보험청구) → 지정(`200`) → 목록의 "토픽" 열이 즉시 갱신, "최근 수정순"에는 영향 없음.
3. TP0로 돌아와 "비활성화" 클릭 → `TopicImpactPreviewDialog` 자동 로딩 → 끊기는 참조 없음 확인 → `[비활성화]`(활성화 후에만 눌리던 버튼이 미리보기 완료로 활성화됨) → 완료.
4. 시뮬레이터에서 "비활성 토픽 포함"을 켜고 해당 의도 예문 입력 → 정상 응답 + "토픽: 보험청구(비활성)" 확인 → 준비 완료 판단 후 TP0에서 "활성화" → 다시 `TopicImpactPreviewDialog`(이번엔 겹치는 예문 표시) → 확인 → 활성화 → 다음 공개 대화부터 실제 응답.

### 5.2 삭제 시도 → 자산 있음 → 공통으로 옮기고 삭제

1. TP0 "삭제" → `DeleteTopicConfirmDialog`가 즉시 `409 TOPIC_NOT_EMPTY` 응답(사전 조회 없이 삭제 시도 → 실패 → 건수 표시로 전환하거나, 목록 응답의 `counts`로 미리 안다 — `frontend-implementer` 재량, 후자 권장) → 종류별 건수 표시.
2. `[공통으로 옮기고 삭제]` 클릭 → 확인 → 성공 → 목록에서 토픽 사라짐 + 해당 자산의 "토픽" 열이 "공통"으로 일괄 갱신(목록 재조회로 반영).

### 5.3 분리 실행 (S-1~S-4 대응 명칭 없음이나 핵심 흐름)

1. TP0 → `[새 챗봇으로 분리]` → 단계① "배송" 선택, 연결 처리 "잘라내기(권장)" → `[다음]`.
2. 단계② 미리보기 자동 계산 → 동반 자산 7건·잘라낼 연결 1건 확인 → 상한 이내 → `[다음]`.
3. 단계③ 이름·slug 확인(자동 파생값 그대로 사용) → `[분리 실행]`.
4. 진행 중(트랜잭션, 최대 15초 기대치) → 성공 → 결과 화면 → `[새 챗봇으로 이동]` → 새 챗봇 대시보드(상태 `DRAFT`).

### 5.4 오류 처리 총괄

| 오류 | 화면 반응 |
|---|---|
| `409 TOPIC_NOT_EMPTY` | 삭제 대화상자에 건수 + "공통으로 옮기고 삭제" 제안 |
| `400 TOPIC_SYSTEM_NODE_LOCKED` | 노드 폼/일괄 지정 인라인 "시작·폴백 노드는 토픽을 지정할 수 없습니다." |
| `422 TOPIC_SPLIT_TOO_LARGE` | 분리 단계②로 복귀 + 초과 종류 강조 |
| `409 TOPIC_SPLIT_BUSY` | 분리 단계④ 배너 + 재시도 버튼 |
| `409 DUPLICATE_SLUG` | 분리 단계③ slug 인라인 |
| `409 DUPLICATE_NAME`(토픽) | `TopicForm` 이름 인라인 |
| `409 LIMIT_EXCEEDED`(토픽 50) | `TopicForm` 상단 배너 / `[+ 토픽 추가]` 사전 비활성 |
| `404 INVALID_REFERENCE`(토픽) | 자산 폼 `TopicSelectField` 인라인 / 일괄 지정 모달 배너 |
| `404 INVALID_REFERENCE`(일괄, 삭제된 자산) | 일괄 지정 모달 배너 + 목록 새로고침 안내 |
| `409 CHATBOT_ARCHIVED` | 해당 화면 쓰기 버튼 재비활성 + 토스트 |
| `403`(권한 부족) | 버튼/화면 자체 미노출(§4) — 직접 URL 진입 시 기존 `L4` 403 안내 재사용 |
| `404`(교차 챗봇 토픽 id) | 기존 `ErrorState` "찾을 수 없습니다." |
| `INTERNAL_ERROR`/미분류 | 공통 토스트: "처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요." |

---

## 6. `UIUX_준수기준.md` 체크리스트 매핑

### 6.1 공통(TP0, 목록 6화면 확장, 분리 마법사 — 관리자 콘솔)

| 기준 | 항목 | 적용 지점 |
|---|---|---|
| §1 색상대비 | 텍스트 4.5:1, 색상 단독 금지 | `TopicStatusBadge`(활성/비활성/공통 — 텍스트+아이콘), `TopicNameChip`, `CrossTopicRefBadge` |
| §2 타이포그래피 | 본문 16~17px | `TopicManagementTable`, `TopicSplitWizard` 본문 |
| §3 키보드접근성 | Tab 순차, Enter/Space, Esc+포커스복귀 | `TopicImpactPreviewDialog`/`DeleteTopicConfirmDialog`/`TopicForm`/`TopicSplitWizard`의 포커스 트랩, `TopicMoveButtons`(위/아래 버튼 Tab 진입) |
| §4 버튼 | 동사형 레이블, 연타 방지, 44×44px | "비활성화"/"활성화"/"분리 실행"/"지정", 확정 버튼 연타 방지(`aria-disabled` + 스피너), 모바일 44×44px |
| §5 텍스트입력필드 | 레이블 필수, 글자수 실시간 | `TopicForm` 설명(200자), 분리 마법사 이름 필드 |
| §6 폼컨트롤 | 단일선택=셀렉트, 다중선택=체크박스, 20개 초과 시 다른 UI | `TopicFilterDropdown`(다중, `MultiSelectDropdown` 재사용), `TopicSelectField`(20개 초과 대응 — 타이핑 필터 콤보박스) |
| §7 오류메시지 | 원인+해결방법, 제출 시점 | §5.4 오류 매핑 전수 |
| §8 로딩/상태 | 스켈레톤, 완료 배지 | `SkeletonRow`(TP0·미리보기), 분리 진행 스피너 |
| §9 내비게이션 | href 기반, 현재 탭 구분 | `DialogueSubNav` 8번째 항목, 설계 점검 토픽 규칙 바로가기 링크 |

### 6.2 화면별

| 화면 | UIUX 항목 | 적용 지점 |
|---|---|---|
| TP0 | §4(터치영역 44×44px) | `TopicMoveButtons`, 행 액션 버튼 |
| `TopicImpactPreviewDialog` | §7(원인+해결방법), §8(로딩 중 확인 버튼 비활성) | 끊기는 참조 표 + 편집 링크, 미리보기 전 확인 버튼 게이팅 |
| `BulkTopicAssignModal` | §1(색상 단독 금지) | 비활성 토픽 이동 경고(텍스트+아이콘) |
| `TopicSplitWizard` | §4(진행 표시 n/N 원칙 준용) | 단계 헤더 "{n}/4단계" |
| `RestoreDialog`(확장) | §1, §7 | `TOPIC_EXPOSURE_CHANGE` 체크박스 게이팅(기존 `ACTIVE_CHATBOT` 패턴 재사용) |
| 시뮬레이터 | §6(체크박스 단일 토글) | "비활성 토픽 포함" |

### 6.3 이번 작업의 `UIUX_준수기준.md` 보강 여부 — **불필요**

이 그룹에서 등장하는 패턴은 전부 **기존 항목의 재적용**이다.

- "미리보기를 받기 전까지 확인 버튼을 내주지 않는다"(§3.2, §3.9) — `version-history-ui-spec.md`의 `RestoreDialog`(blockers 게이팅)·`ActiveChatbotAcknowledgeCheckbox` 선례를 그대로 재사용한다. 새 원칙이 아니다.
- "옵션이 많은 단일 선택에 타이핑 필터 콤보박스를 쓴다"(`TopicSelectField`) — 이미 §6이 "20개 초과 시 셀렉트 대신 다른 UI 권장"으로 규정하고 있고, `ResourcePickerField` 선례가 이미 존재한다.
- "마법사형 대화상자의 단계 표시"(§3.7) — §4의 "대화형 설문 문항 n/N 진행 표시" 원칙을 관리자 화면에 준용한 것으로, 별도 문서 보강 없이도 근거를 §4 각주로 명시하는 것으로 충분하다.
- 따라서 **`UIUX_준수기준.md` 파일은 수정하지 않는다.**

### 6.4 자동화 연계

`AC-TP7-3`(axe 대비 위반 0, 토픽이 텍스트로 구분됨, 키보드만으로 토픽 생성→일괄 지정→비활성화→분리 완료), `AC-TP7-4`(공개 응답·위젯 네트워크에 토픽 id·이름 0건)는 `test-automation` 검증 대상이며, 본 설계의 href 기반 링크·포커스 트랩·게이팅 버튼 규칙이 그 전제 조건이다.

---

## 7. 반응형 고려사항

### 7.1 관리자 콘솔(`apps/web`)

| 브레이크포인트 | 폭 | 레이아웃 변화 |
|---|---|---|
| 데스크톱 | ≥1024px | TP0: 표 그대로(자산 수 6종 열 전부 노출). `TopicSplitWizard`: `modal--lg` 고정폭, 미리보기 표 스크롤 가능 |
| 태블릿 | 640~1023px | TP0: 자산 수 6종 열을 "자산 84건"(합계) + 펼침 아이콘으로 축약. 목록 6화면의 `TopicFilterDropdown`은 기존 필터 바와 같은 접힘 규칙(`dialogue-design-ui-spec.md` §7 태블릿 규칙 상속) |
| 모바일 | <640px | TP0: 표 대신 카드 리스트(토픽명 + `TopicStatusBadge` + 자산 합계 + 액션 케밥 메뉴). `TopicSplitWizard`는 전체화면으로 전환(단계 헤더 상단 고정). 목록 6화면은 기존 카드 리스트 패턴(`dialogue-design-ui-spec.md` §7 모바일 규칙)에 "토픽" 라벨-값 행 추가. 모든 버튼 44×44px 유지 |

### 7.2 위젯(`apps/widget`)

영향 없음 — 이 그룹은 위젯 코드·마크업을 전혀 바꾸지 않는다(§0.5).

---

## 8. `messages.ts` 신규 키 목록 (`apps/web/src/constants/messages.ts`)

### 8.1 신규 네임스페이스 `MESSAGES.topics`

```
navLabel,  // DialogueShell subNav.topics 값과 동일 문자열 "토픽"
pageTitle, limitLabel(current, max), addButton, addButtonLimitReached,
commonRowLabel, commonRowHint,
columnName, columnStatus, columnIntents, columnKeywords, columnHomonyms,
columnContexts, columnNodes, columnFaqs, columnCrossRefs,
statusActive, statusInactive, statusCommon,
moveUpAction, moveDownAction, editAction, enableAction, disableAction, deleteAction, splitAction,
emptyTitle, emptyDesc,

formNameLabel, formDescriptionLabel, formInitialEnabledLabel,
duplicateName, limitExceeded, nameLengthError, descriptionLengthError,

deleteConfirmTitle, deleteEmptyConfirmDesc, deleteNotEmptyDesc(counts),
deleteMoveToCommonButton, deleteRetryStaleCounts,

impactDialogTitle(topicName, action), impactLoading,
impactAlreadyInState, impactEntryPointsSummary(nodes, intents, faqs),
impactBrokenRefsTitle(total), impactBrokenRefsEmpty,
impactLiveEntryPointsAfterZero, impactDuplicateExamplesTitle(total),
impactPendingScheduleNotice(count), impactMultiInstanceNotice,
impactConfirmDisable, impactConfirmEnable, impactErrorRetry,

bulkAssignTitle(kind, count), bulkAssignTargetLabel,
bulkAssignInactiveWarning(nodes, intents, faqs),
bulkAssignUpdatedAtHint, bulkAssignPendingScheduleNotice(count),
bulkAssignSystemNodeExcluded(count),
bulkAssignSubmit, bulkAssignSuccess(count, topicName),
bulkAssignPartialFailure(count),

filterLabel, filterAllLabel, filterCommonLabel, filterDeletedTopicChip,
listColumnTopic, crossTopicRefBadge(count),

topicFieldLabel, topicFieldSystemLockedHint, topicFieldInvalidReference,
sortRecentTopicChangeHint,

exportTopicFilterHint, importNewItemTopicLabel, importExistingItemTopicHint,

splitEntryButton,
splitStepIndicator(step, total),
splitStep1Title, splitStep1TopicsLabel, splitStep1IncludeCommonLabel,
splitStep1SystemLinksLabel, splitStep1SystemLinksTrim, splitStep1SystemLinksFollow,
splitStep1NextDisabledHint,
splitStep2Title, splitStep2SelectedCounts, splitStep2ClosureTitle(count),
splitStep2ClosureDominatesWarning, splitStep2SystemNodesLine(start, fallback),
splitStep2TrimmedLinksTitle(count), splitStep2FollowedLinksTitle(count),
splitStep2SurveysDuplicated(count), splitStep2ApiConnectionsKept(count),
splitStep2NotCopiedTitle, splitStep2SizeEstimateTitle, splitStep2ExceededLabel(kind, count, limit),
splitStep3NameLabel, splitStep3SlugLabel, splitStep3GroupLabel, splitStep3DraftNotice,
splitStep3DuplicateSlug, splitStep3ArchivedGroup,
splitStep4Success(chatbotName), splitStep4Counts, splitStep4DesignCheckSummary(error, warning, info),
splitStep4ReindexingNotice, splitStep4NotCopiedTitle, splitStep4OriginalDisableHint,
splitStep4GoToChatbot, splitStep4Close,
splitBusyError, splitTooLargeError,

designRuleInactiveTopicReference(source, sourceTopic, target, targetTopic),
designRuleCrossTopicReference(sourceTopic, source, targetTopic, target),
designRuleCrossTopicDuplicateExample(topicA, intentA, topicB, intentB),
designRuleNoLiveEntryPoint, designRuleGoToTopics,

simulatorIncludeInactiveLabel, simulatorAnsweredTopic(name, status), simulatorTcNoToggleHint,

restoreWarningTopicMissing(count), restoreWarningTopicExposureChange(exposed, hidden),
restoreAcknowledgeTopicExposure,

suggestedIntentTopicBadge(name, status),
```

### 8.2 기존 네임스페이스 갱신

```
MESSAGES.dialogue.subNav.topics: '토픽',                          // DialogueShell 8번째
MESSAGES.dialogue.filterBar.topicLabel: '토픽',                     // 목록 6화면 공용 필터 바
MESSAGES.dialogue.filterBar.commonLabel: '공통',
MESSAGES.errors.TOPIC_NOT_EMPTY / TOPIC_SYSTEM_NODE_LOCKED / TOPIC_SPLIT_TOO_LARGE / TOPIC_SPLIT_BUSY,
MESSAGES.versionHistory.restoreWarnings.TOPIC_MISSING / TOPIC_EXPOSURE_CHANGE,   // §3.9
MESSAGES.learning.suggestedIntent.topicBadge,                      // §3.10
```

---

## 9. `frontend-implementer` 인계 메모

1. **`DialogueShell.tsx`의 `SUBNAV_ITEMS`에 `'topics'`를 8번째로 추가**한다(§0.2). `TabNav.tsx`(최상위 라우트 4개, `AC-C-3`)는 손대지 않는다.
2. **구현 순서 권고**: ① TP0 목록·생성·수정·순서 → ② 삭제(+공통으로 옮기기) → ③ 활성/비활성 `TopicImpactPreviewDialog`(게이팅이 핵심) → ④ 목록 6화면 필터·열·`TopicSelectField`(자산 폼) → ⑤ `BulkTopicAssignModal` → ⑥ 설계 점검 패널 4종 → ⑦ 내보내기/가져오기 확장 → ⑧ `TopicSplitWizard`(가장 복잡 — 4단계 상태 관리) → ⑨ 시뮬레이터 토글 → ⑩ 복원 경고 2종(백엔드의 `acknowledgeTopicExposure` 필드 추가와 동시 진행 필요) → ⑪ 미응답 큐 배지(가장 가벼움).
3. **`TopicSelectField`는 서버 검색을 하지 않는다** — 챗봇 진입 시(또는 목록 화면 최초 로드 시) `GET …/topics`로 전량을 한 번 가져와 클라이언트 상태로 공유하고, 모든 자산 폼·필터·일괄 지정 모달이 이 캐시를 재사용한다(토픽당 요청 1회 원칙 — 화면마다 다시 조회하지 않는다).
4. **`TopicImpactPreviewDialog`·`RestoreDialog`(`TOPIC_EXPOSURE_CHANGE`)의 확인 버튼은 "미리보기 응답 수신"과 "체크박스 상태" 둘 다를 조건으로 삼는다** — 둘 중 하나라도 미충족이면 `aria-disabled`. 서버는 이 게이팅을 강제하지 않으므로(증빙 불요구) **프런트가 유일한 방어선**이다.
5. **백엔드 계약 추가 요청**: `POST …/versions/:versionId/restore` 요청 바디에 `acknowledgeTopicExposure: boolean` 필드가 필요하다(§3.9) — `docs/02-spec/topic-system-설계.md` §11 작성 시점에는 없던 필드이며, PM이 이후 확인 체크로 강화했다(이 문서 §0.1). `backend-implementer`에게 별도로 전달할 것.
6. **"최근 수정순 정렬에 반영되지 않음" 안내는 최소 2곳**에 필요하다 — (1) 목록 6화면 정렬 드롭다운의 "최근 수정순" 옵션 도움말, (2) `BulkTopicAssignModal` 안내 문구. 두 곳 다 §8의 `sortRecentTopicChangeHint`/`bulkAssignUpdatedAtHint` 키를 쓴다.
7. **START/FALLBACK 노드 폼은 `TopicSelectField`를 아예 렌더하지 않는다**(`SystemNodeTopicLockedHint`로 대체) — 비활성화된 셀렉트를 보여주지 않는다(권한 없는 버튼을 숨기는 F-4 원칙과 같은 이유: "선택할 수 없는 필드"가 아니라 "이 필드 자체가 의미 없음"이기 때문).
8. **분리 마법사는 단계 간 상태를 잃지 않는다** — ②→①로 돌아갔다가 값을 바꾸지 않고 다시 `[다음]`을 누르면 미리보기를 재요청한다(캐시하지 않는다 — 경합 가능성 때문에 항상 최신 상태를 다시 계산). ③→②로 돌아가는 경우는 이미 가진 미리보기 결과를 재사용해도 된다(선택 자체가 바뀌지 않았으므로).
9. **분리 실행 중(§3.7.4) 모달은 `Esc`·배경 클릭을 비활성화**한다(`RestoreDialog` 확정 진행 패턴과 동일 — 이탈 시 트랜잭션 상태를 오해할 수 있다).
10. **노드 목록의 `CrossTopicRefBadge`는 쿼리 수를 늘리지 않는다** — 서버가 이미 노드 목록 응답에 필요한 필드를 포함해 보내므로(설계서 §5.3), 프런트가 별도로 참조 그래프를 계산하지 않는다(서버 계산 값을 그대로 렌더).
