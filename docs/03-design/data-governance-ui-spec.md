# 데이터 거버넌스 (No.45) — 화면 설계서

> **요구사항**: `docs/requirements/data-governance.md`(FR-0-161~171 · FR-DG1~DG9 · NFR-DGA1~4 · AC-DG1~DG8 · EX-DG-1~24 · P-1~P-12 전부 추천안 확정, 2026-09-26)
> **설계**: `docs/02-spec/data-governance-설계.md`(§5~§16 · §20 관리자 콘솔 인계 · §24 해석 조정) · **ADR-0040**
> **UIUX 기준**: `docs/03-design/UIUX_준수기준.md`(특히 §1 색상 단독 금지·민감정보 열람 토글, §3 키보드, §6 폼, §7 오류, §8 로딩, §9 내비게이션)
> **형식 참조**: `docs/03-design/environment-separation-ui-spec.md` · `docs/03-design/feedback-loop-ui-spec.md`
> **작성일**: 2026-09-26 · **최종 반영**: 2026-09-26(PM 결정 — §3.10 신설·§13 확정) · **범위**: `apps/web`만(관리자 콘솔). `apps/widget`·`packages/dialogue-engine`·`apps/ml-worker` 변경 0(FR-0-162 · G-13).

---

## 0. 전제와 연계 확인

- 이 그룹은 **읽기 전용 데이터 지도 + 보존기간 설정(일수만) + 감사 무결성 검증 + 파기 이력 조회**가 콘솔에서 할 수 있는 전부다. **모드·출구 허용 목록·암호화 켜기/끄기·키·감사/대화 보존 하한·마스킹 강도는 전부 환경변수 전용**이며 콘솔에는 그 값을 "읽기"로만 보여준다(FR-DG9-2 · AC-DG8-2 — 이 화면들에는 그 값을 **바꾸는 입력·버튼이 존재하지 않는다**).
- 위젯(`apps/widget`)은 이 그룹으로 인해 달라지는 것이 없다. 최종 사용자가 보는 화면·API 응답 모양은 불변이다(FR-0-161·162).
- 코드 확인 결과(구현 참고):
  - 전역 보안 설정류 화면은 `apps/web/src/pages/settings/**`에 있다(`AuditLogsPage.tsx`·`BannedWordsPage.tsx`·`ApiConnectionsPage.tsx`·`UsersPage.tsx`·`DeploySchedulesPage.tsx`). 감사로그 하위 컴포넌트는 `pages/settings/audit-logs/**`, API 연결 하위 컴포넌트는 `pages/settings/api-connections/**`.
  - 콘솔 진입 메뉴는 `apps/web/src/components/security/SystemSettingsMenu.tsx`(권한별 필터링 드롭다운)다.
  - 라우트는 `apps/web/src/App.tsx`에 챗봇 상세 트리(`/chatbots/:chatbotId/*`, `ChatbotDetailLayout`)와 전역 설정 트리(`/settings/*`, 플랫 라우트)가 분리돼 있다.
  - 챗봇별 탭(`TabNav.tsx`)의 "설정" 탭은 `SettingsTab.tsx` 1페이지(기본 정보 폼)이며 하위 탭이 없다.
  - 상담(No.24) 원문 토글은 `components/handoff/RawTextToggle.tsx`(기본 꺼짐 + 켤 때 감사 고지 팝오버) — 이 그룹은 이 컴포넌트를 **바꾸지 않는다**(§7.8 참고).
  - 확인 문자열 재입력 패턴 선례는 `pages/settings/api-connections/RawPersonalDataConfirmField.tsx`(연결 이름 재입력 — `allowRawPersonalData` 켤 때)다. 이 그룹의 보존기간 단축 확인에 **같은 패턴을 재사용**한다.
  - 감사 액션 배지는 `components/security/badges.tsx`의 `AuditActionBadge`(`AUDIT_ACTION_COLOR` Record), 외부 연동 결과 배지는 `pages/settings/api-connections/badges.tsx`의 `ApiCallOutcomeBadge`(`OUTCOME_TONE` Record) — 둘 다 **TS `Record<Enum, …>`라 신규 열거값을 빠뜨리면 컴파일이 깨진다**(설계서 §2.4 "컴파일 강제"). 이 문서는 `VIEW`·`EXPORT`·`EGRESS_BLOCKED`의 라벨·톤만 지정하고, 실제 추가는 frontend-implementer가 같은 Record에 키를 더하는 것으로 끝난다.
  - 공용 확인 모달은 `components/Modal.tsx`의 `ConfirmDialog`(포커스 트랩·Esc 취소·기본 포커스 "취소") — NFR-DGA2를 그대로 만족한다.
  - 기간 선택은 `components/DateRangeField.tsx`(`<input type="date">` 2개 + 상한 안내), 진행률 표시는 `components/AsyncJobProgress.tsx`(`role="status" aria-live="polite"` + `<progress>`), 데스크톱 표 + 모바일 카드 이중 렌더 선례는 `pages/settings/audit-logs/AuditLogCard.tsx`.
  - 정적(비-라이브 리전) info 배너 선례는 `AuditLogsPage.tsx`의 보존 고지(`<p className="form-banner form-banner--info">{msg.retentionNotice(...)}</p>`)이고, 라이브 리전 배너 선례는 `components/EnvironmentScopeNotice.tsx`(`role="status"`)다 — 이 둘은 접근성 성격이 다르며 §3.10에서 어느 쪽을 쓰는지 명시한다.

---

## 1. 화면 목록 및 라우트

| # | 화면 | 라우트 | 권한 | 유형 |
|---|---|---|---|---|
| G1 | 데이터 거버넌스 — 데이터 지도 | `/settings/data-governance`(index → `map`) `/settings/data-governance/map` | `security:read` | 신규 |
| G1-b | 데이터 거버넌스 — 보존 정책(전역) | `/settings/data-governance/retention` | 조회 `security:read` · 저장 `security:write` | 신규 |
| G1-c | 데이터 거버넌스 — 파기 이력 | `/settings/data-governance/purge-history` | `security:read` | 신규 |
| G2 | 챗봇 설정 — 보존기간 재정의 | `/chatbots/:chatbotId/settings?section=retention`(기존 `SettingsTab` 안 서브탭) | 조회 `chatbot:read`+`security:read` · 저장 `chatbot:read`+`security:write` | 기존 화면 확장 |
| G3 | 이력 관리(감사로그) — 무결성 검증·체인 정보·열람/내보내기 필터 | `/settings/audit-logs`(기존) | 검증 `audit:read` | 기존 화면 확장 |
| G4 | API 연결 — 저장 차단·호출 로그 배지 | `/settings/api-connections`(기존) | `security:read`/`security:write`(기존) | 기존 화면 확장 |
| G5 | 파기 표시(횡단) — 대화 보기·상담 이력 상세·설문 응답·미응답 질문 상세 | 기존 각 라우트(`/handoff-console/**`·`/chatbots/:chatbotId/stats/**`) | 기존 권한 | 기존 화면 확장 |
| G6 | 시스템 설정 메뉴에 "데이터 거버넌스" 항목 추가 | — | `security:read` | 기존 화면 확장 |
| G7 | 열람 감사 안내 배너(VIEW 대상 8개 화면 공통, **2026-09-26 PM 확정 신설**) | 기존 각 화면(§3.10 표) | 기존 권한 그대로(추가 권한 없음) | 기존 화면 확장 |

G1~G1-c는 새 최상위 서브라우트 트리(`DataGovernanceShell`)이며 나머지는 기존 파일에 조각을 더하는 확장이다. 신규 화면·확장 화면 전부 **모드 OFF에서도 읽기로 동작**한다(FR-DG1-6·P-12) — G1은 항상 열리고, G1-b·G1-c도 항상 열리되 "거버넌스 모드 꺼짐" 배너가 상단에 붙는다.

---

## 2. 공통 UI 요소

### 2.1 재사용(변경 없음)

`ConfirmDialog`/`Modal` · `DateRangeField` · `AsyncJobProgress` · `EmptyState`/`ErrorState`/`SkeletonRow` · `Pagination` · `InlineFieldError` · `CopyButton`(해시·seq 복사) · `RawPersonalDataConfirmField`(패턴 재사용 — 신규 컴포넌트로 일반화, §2.3) · `AuditLogFilterBar`/`AuditLogDetailPanel`/`AuditLogCard`(감사로그 페이지 골격 불변, 필드만 확장) · `RawTextToggle`(No.24 원문 토글 — **무변경**).

### 2.2 신규 배지 — 기존 Record 확장(컴파일 강제)

**`AuditActionBadge`**(`components/security/badges.tsx`) — `AUDIT_ACTION_COLOR`에 2건 추가:

| 액션 | 아이콘 | 배경/글자색 | 라벨 |
|---|---|---|---|
| `VIEW` | `👁`(aria-hidden) | `#E0F2FE` / `#075985` | "열람" |
| `EXPORT` | `⬇` | `#DBEAFE` / `#1D4ED8` | "내보내기" |

기존 `RAW_VIEW`(`#E0E7FF`/`#3730A3`, "원문 열람")와 시각적으로 구분되는 톤을 쓴다 — 같은 화면에서 `VIEW`와 `RAW_VIEW`가 같은 목록에 동시에 나타날 수 있으므로(§7.8) 배지 색이 겹치면 안 된다.

**`ApiCallOutcomeBadge`**(`pages/settings/api-connections/badges.tsx`) — `OUTCOME_TONE`에 1건 추가:

| 값 | 톤 | 라벨 |
|---|---|---|
| `EGRESS_BLOCKED` | `#F3F4F6` / `#374151`(`BLOCKED_ADDRESS`·`BLOCKED_URL`과 같은 중립-경고 톤) | "외부 전송 차단" |

### 2.3 신규 컴포넌트

| 컴포넌트 | 위치(제안) | 역할 |
|---|---|---|
| `DataGovernanceModeBanner` | `components/DataGovernanceModeBanner.tsx` | 모드 OFF일 때 상단 배너("거버넌스 모드 꺼짐 — 외부 전송 통제·필드 암호화·열람 감사가 적용되지 않습니다", FR-DG1-6). G1·G1-b·G1-c 공통. `role="status"`가 아니라 상시 표시 배너(`.form-banner form-banner--info`류 — 매 렌더 알림이 아님, 조용한 정적 배너). |
| `GovernanceViewAuditBanner` | `components/GovernanceViewAuditBanner.tsx` | **(2026-09-26 PM 확정 신설)** 거버넌스 모드 ON일 때 `VIEW` 감사 대상 8개 화면 상단에 정적 안내("이 화면 열람은 감사로그에 기록됩니다"). `role`/`aria-live` 없음 — §3.10에서 상세 규정. |
| `EgressJudgementBadge` | `components/DataGovernanceBadges.tsx` | 출구 판정 4값 텍스트+색: 허용(`#DCFCE7`/`#166534`, "●") · 차단(`#FEE2E2`/`#991B1B`, "✖") · 미설정(`#F3F4F6`/`#374151`, "—", "설정 안 됨") · 집행 안 함(`#F3F4F6`/`#374151`, "모드 꺼짐 — 집행 안 함") — NFR-DGA1(색상 단독 금지). |
| `ChainVerifyResultBadge` | 동일 파일 | 검증 결과 6값: 정상 · 불일치 · 순번 결손 · 최신 기록 누락 · 서명 키 없음 · 검증 시작점 없음(§3.3 표). |
| `PurgedFieldNotice` | `components/DataGovernanceBadges.tsx` | 소거된 텍스트 자리에 표시하는 고정 문구 컴포넌트: `<span className="purged-text"><span aria-hidden="true">🗑</span> 보존기간 경과로 파기됨</span>`(NFR-DGA4 — 회색만이 아니라 텍스트로 읽힘). G5 전 화면 공용. |
| `DecryptFailedNotice` | 동일 파일 | 복호화 실패 자리 표시: `<span className="decrypt-failed-text"><span aria-hidden="true">⚠</span> [복호화 실패]</span>`(경고 톤 — `PurgedFieldNotice`와 시각적으로 다름, §5.5 참고). |
| `RetentionConfirmField` | `components/DataGovernanceBadges.tsx` 또는 `pages/settings/data-governance/RetentionConfirmField.tsx` | `RawPersonalDataConfirmField`와 동일한 패턴(재입력 텍스트가 기대값과 다르면 인라인 오류 + 저장 버튼 비활성) — 기대값이 고정 문구("보존기간 단축") 또는 챗봇 이름으로 바뀔 뿐이라 **일반화한 컴포넌트 1개**로 두 화면(G1-b·G2)이 공유한다. |
| `RetentionKindEditor` | `pages/settings/data-governance/RetentionKindEditor.tsx` | 보존 대상 종류 1행(라벨·현재 유효값·새 값 입력·하한 안내·"무기한" 체크박스) — G1-b(6종)·G2(4종)가 공유. |
| `RetentionPreviewTable` | 동일 디렉터리 | 미리보기 결과(대상별 `affectedCount`·`firstPurgeAt`·단축 여부) 표. |
| `PurgeRunResultBadge` | `components/DataGovernanceBadges.tsx` | `RetentionRun.status` 3값(성공/부분 처리/실패) + `resultCode` 보조 문구(§3.3 매핑표). |

---

## 3. 화면별 설계

## 3.1 G1 — 데이터 지도 (`/settings/data-governance/map`)

### 목적
`security:read` 사용자가 저장 위치·외부 전송·필드 암호화·보존·감사 체인·잔존 위험을 **한 화면에서 읽기**로 확인해 규제 심사에 대응한다(S-2). 콘솔에서 바꿀 수 있는 값은 하나도 없다(AC-DG8-2).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | 카드 6개 자리에 `SkeletonRow` × 6 |
| 성공 | §3.1.1 레이아웃 |
| 조회 실패(`500` 등) | `ErrorState`(재시도 버튼) |
| 모드 OFF | 최상단 `DataGovernanceModeBanner` + 카드 값은 그대로 표시(대부분 "미설정"·"집행 안 함"으로 보임) |
| 권한 없음(`security:read` 없음) | 진입 자체가 `RequirePermission`으로 차단(`ForbiddenState`, 기존 패턴) |

### 3.1.1 레이아웃 (데스크톱)

```
┌ 데이터 거버넌스 ──────────────────────────────────────────────────┐
│ [데이터 지도] [보존 정책] [파기 이력]                    (탭, role=tablist)│
├────────────────────────────────────────────────────────────────┤
│ ⓘ 거버넌스 모드 꺼짐 — 외부 전송 통제·필드 암호화·열람 감사 미적용        │  ← 모드 OFF에서만
├─ 모드 · 저장 위치 ─────────────────────────────────────────────────┤
│ 거버넌스 모드: 꺼짐                                                 │
│ 저장 위치: /secure/chatbot/prod.db (허용 경로 — SQLite)              │
│ 허용 저장 경로: /secure/chatbot                                    │
│ 디스크 암호화(운영자 신고값): 예 — 이 값은 운영자가 직접 신고한 것이며,     │
│   애플리케이션이 실제로 검증하지 못합니다.                              │
├─ 외부 전송(출구 5종 + 레거시 연결) ────────────────────────────────┤
│ 출구        대상 호스트          송신 데이터        마스킹  판정   차단(24h)│
│ 임베딩      ml-worker.internal   질의 원문(⚠원문)    안 함  ● 허용   0    │
│ 외부 RAG    (미설정)             마스킹된 질문        함    — 미설정  —   │
│ 증강(Gemini) (미설정)            마스킹된 예문 시드     함    — 미설정  —   │
│ 증강(로컬)   (미설정)             예문 시드(비마스킹)   안 함  — 미설정  —   │
│ 레거시 연결(3) — 아래 상세                                            │
│  · 은행계좌조회 API   legacy.bank.internal   폼 슬롯 값   연결별   ● 허용  0│
│  · 파트너 조회 API    api.partner.com        폼 슬롯 값   연결별   ✖ 차단  3│
│ ⚠ 임베딩: 질의 원문이 이 서버 밖으로 전송됩니다(허용 호스트 ml-worker.internal)│
├─ 필드 암호화 ──────────────────────────────────────────────────────┤
│ 대상: 상담 원문 · 상담 메시지 · 설문 자유 텍스트 (3필드)                  │
│ 상태: 켜짐 · 쓰기 키 k2                                              │
│ 키별 행 수: k2 812,004행 · k1 3,201행(재암호화 대상)                   │
│ 평문 잔존: 0행                                                      │
│ [재암호화 진행 중 — 92%]  (AsyncJobProgress, 진행 중일 때만)            │
│ 보호 범위: DB 파일·백업·내보낸 사본이 유출된 경우                        │
│ 보호하지 못하는 범위: 서버 자체 또는 환경변수 접근 권한이 있는 경우         │
├─ 보존 현황 ────────────────────────────────────────────────────────┤
│ 대화 로그 본문: 180일(전역) · 재정의 챗봇 2곳                          │
│ 종결 미응답·평가 질문: 180일(전역)                                    │
│ 설문 자유 텍스트: 180일(전역)                                        │
│ 상담 메시지: 180일(전역) · 재정의 챗봇 1곳                             │
│ 외부 연동 호출 로그: 90일(전역만)                                     │
│ 감사로그: 1825일(전역만, 서버 하한 365일)                             │
│ 다음 파기 예정: 09-27 02:00 · 최근 결과: 성공(09-26 02:00, 1,190,002행)│
│ 감사 체인: 정상(최근 검증 09-26 02:10) · 머리 seq 1,882,410 / 9f3a…[복사]│
├─ 잔존 위험 점검 ────────────────────────────────────────────────────┤
│ v1 노드 평문 토큰: 2개 노드 · 3개 스냅샷(점검 시각 09-20)               │
│   → 제거 방법: 노드를 v2로 전환하거나 해당 버전을 삭제하세요.            │
│ 원문 조회 허용 연결(allowRawPersonalData): 1개                        │
│ 외부 LLM 증강 사용: 아니오                                           │
│ 마스킹 강도: 기본(PARTIAL)                                          │
└────────────────────────────────────────────────────────────────┘
```

모바일(≤768px)은 카드 순서 그대로 세로 스택, 출구 표는 `AuditLogCard` 선례처럼 표 대신 카드 리스트로 전환한다(§7).

### 컴포넌트 분해 및 데이터 바인딩

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `DataGovernanceMapPage` | `GET /governance/map`(`GovernanceMapResponse`) 1회 로드(폴링 없음 — 정적 요약, FR-DG1-6 "화면 조회 자체는 감사하지 않는다") |
| `EgressTable` | `map.egress`(5클래스 배열) + `map.legacyConnections`(연결별 배열) — 각 행 `EgressJudgementBadge` |
| `FieldEncryptionCard` | `map.encryption`(`enabled`·`keyStats[]`·`plaintextRemaining`·`backfillProgress?`) — `backfillProgress`가 있으면 `AsyncJobProgress` |
| `RetentionSummaryCard` | `map.retention`(대상별 `effectiveDays`·`overrideCount`·`nextPurgeAt`·`lastRun`) + `map.auditChain`(`status`·`lastVerifiedAt`·`headSeq`·`headHashPrefix`) |
| `ResidualRiskCard` | `map.residualRisk`(`v1TokenNodes`·`v1SnapshotCount`·`v1CheckedAt`·`rawPersonalDataConnections`·`externalLlmAugmentation`·`maskingMode`) |

---

## 3.2 G1-b — 보존 정책(전역) (`/settings/data-governance/retention`)

### 목적
전역 보존기간 6종을 조회·저장한다. 단축은 미리보기 + 확인 문자열 + 유예를 거친다(S-3).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 6 |
| 조회 성공 | §3.2.1 폼 |
| 대기 중 단축 있음 | "적용 예정" 블록(§3.2.2) 노출 |
| 저장 중 | 저장 버튼 스피너+`disabled` |
| `400 RETENTION_OUT_OF_RANGE` | 해당 종류 입력 아래 인라인 오류("허용 범위: 7~3650일") |
| `400 CONFIRM_NAME_MISMATCH` | 확인 문자열 필드 인라인 오류 |
| `503 AGGREGATION_TIMEOUT` | 미리보기 영역에 `ErrorState`(재시도) |
| 저장 성공 | `aria-live="polite"` 1회 안내("보존 정책이 저장되었습니다" 또는 "보존 정책 변경이 예약되었습니다 — 10-03부터 적용") + Toast |

### 3.2.1 레이아웃

```
┌ 보존 정책(전역) ───────────────────────────────────────────────────┐
│ ⓘ 거버넌스 모드 꺼짐 — 배너                                          │
│                                                                    │
│ 종류               현재 적용값        새 값                하한 안내     │
│ 대화 로그 본문      180일             [   90] □무기한       최소 7일    │
│ 종결 미응답·평가질문 180일             [  180] □무기한       최소 7일    │
│ 설문 자유 텍스트    무기한             □[  365] ■무기한      최소 7일    │
│ 상담 메시지        180일             [  180] □무기한       최소 7일    │
│ 외부 연동 호출 로그  90일              [   90] □무기한       최소 1일    │
│ 감사로그           1825일            [ 1825] □무기한       최소 365일   │
│                                                                    │
│                                    [변경 내용 확인(미리보기)]           │
│                                                                    │
│ ── 미리보기 결과 ──────────────────────────────────────────────────│
│ 대화 로그 본문: 90일로 단축 → 1,204,331행 · 10-03(유예 7일)부터 파기됨 │
│ 설문 자유 텍스트: 무기한 유지 → 변경 없음                              │
│ 통계 수치는 변하지 않습니다. 이미 파기된 텍스트는 되돌릴 수 없습니다.     │
│                                                                    │
│ 단축이 포함되어 있습니다 — 계속하려면 "보존기간 단축"을 입력하세요.      │
│ [___________________]                                             │
│                                                                    │
│                                          [취소]  [보존기간 90일로 단축]│
└────────────────────────────────────────────────────────────────┘

── 적용 예정(대기 중) ───────────────────────────────────────────────
│ 대화 로그 본문 90일 → 10-03 09:00부터 적용                           │
│ 상담 메시지 60일 → 10-03 09:00부터 적용                              │
│                                          [예정된 단축 전체 취소]      │
└────────────────────────────────────────────────────────────────┘

── 챗봇별 재정의 ────────────────────────────────────────────────────
│ 챗봇          상태      대화로그 재정의  상담메시지 재정의             │
│ 대출 상담봇    운영중    90일           전역 따름         [상세 →]     │
│ (총 2곳 — 전체 보기: 챗봇 설정 > 보존기간)                            │
└────────────────────────────────────────────────────────────────┘
```

- "새 값" 입력은 숫자 필드 + "무기한" 체크박스(체크 시 숫자 필드 비활성 — 값 0 강요 금지, UIUX §6 "기본값 임의 선택 금지"에 맞춰 초기값은 **현재 유효값**으로 채워 두고 사용자가 명시적으로 바꾼 값만 반영한다).
- 확정 버튼 라벨은 "저장"이 아니라 단축이 하나라도 있으면 **가장 큰 단축 1건을 대표로 "보존기간 N일로 단축"**(NFR-DGA2 — 위험 동작 버튼 이름 명시, `RawPersonalDataConfirmField`/`EnvironmentEnableDialog` 선례). 단축이 없고 연장·무기한 전환만 있으면 버튼은 "저장"(확인 문자열 불요 — FR-DG5-5).
- "예정된 단축 전체 취소" 버튼은 **개별 종류별이 아니라 대기 중인 단축 전부를 한 번에 취소**한다(설계서 §8.3 — `POST …/pending/cancel`이 pending 전체를 지운다). 이 사실을 버튼 라벨과 도움말 텍스트("이 버튼은 대기 중인 모든 단축을 취소합니다")로 명시한다. **(2026-09-26 PM 확정 — §13-3, 현재 안대로 진행)**
- 감사로그 종류는 서버 하한(365일) 미만 입력 시 **저장 전에 이미** 입력 필드 밖에 하한 텍스트가 보이고, 하한 미만 값을 넣고 확인하면 `RETENTION_OUT_OF_RANGE` 인라인 오류(UIUX §7 — 제출 시점 표시, 포커스 이동만으로 팝업 띄우지 않음).

### 3.2.2 상호작용 흐름

```
값 편집 → [변경 내용 확인] 클릭
  → POST /governance/retention/preview(현재 폼의 6종 값 전체)
  → 로딩(RetentionPreviewTable 자리에 SkeletonRow)
  → 성공: 종류별 결과 표 + (단축 있으면) 확인 문자열 필드 노출
  → 확인 문자열 일치 확인(클라이언트에서도 즉시 대조 — RawPersonalDataConfirmField 패턴) → 저장 버튼 활성화
  → [보존기간 N일로 단축] 클릭 → PUT /governance/retention(변경분 + confirmText)
    → 성공: 폼을 응답값으로 재초기화 + "적용 예정" 블록 갱신 + Toast + 감사 1건(사용자 화면 변화는 없음)
    → 400 RETENTION_OUT_OF_RANGE: 해당 필드 인라인 오류, 나머지 값 유지
    → 400 CONFIRM_NAME_MISMATCH: 확인 문자열 필드만 오류, 나머지 값 유지(재시도 쉽게)
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `DataGovernanceRetentionPage` | `GET /governance/retention` 로드 → 로컬 폼 상태(6종) |
| `RetentionKindEditor` × 6 | `kind`, `label`, `currentEffectiveDays`, `value`, `unlimited`, `minDays`, `onChange` |
| `RetentionPreviewTable` | `POST …/preview` 응답(`RetentionPreviewResponse`) — 종류별 `affectedCount`·`firstPurgeAt`·`requiresConfirm` |
| `RetentionConfirmField` | `expected="보존기간 단축"`, `value`, `onChange` |
| `PendingRetentionBanner` | `policy.pending`(kind별 `{days, effectiveAt}` 맵) + `onCancelAll` → `POST …/pending/cancel` |
| `ChatbotRetentionOverridesTable` | `GET /governance/retention/overrides`(페이지네이션) — 행 클릭 시 `/chatbots/:chatbotId/settings?section=retention`로 이동 |

---

## 3.3 G1-c — 파기 이력 (`/settings/data-governance/purge-history`)

### 목적
자동 파기·백필/재암호화·체인 검증 실행 이력을 조회한다(S-5). 본문·행 id 목록은 없다(FR-DG6-7).

### 상태별 UI

| 상태 | UI |
|---|---|
| 로딩 | `SkeletonRow` × 5 |
| 결과 있음 | §3.3.1 표 |
| 결과 없음(잡 비활성 또는 정책 전부 무기한) | `EmptyState`("아직 파기 실행 이력이 없습니다 — 보존 정책이 전부 무기한이면 파기할 대상이 없습니다") |
| 조회 실패 | `ErrorState`(재시도) |

### 3.3.1 레이아웃(데스크톱 표 / 모바일 카드)

```
필터: [대상 종류 ▾] [챗봇 ▾] [기간: 2026-09-01 ~ 2026-09-26]

실행 시각        종류            대상       일수  기준시각(cutoff)  처리건수    결과
09-26 02:00     대화 로그 본문   전 챗봇    180   04-06 이전      1,190,002  ✔ 성공
09-26 02:00     감사로그        전역       1825  2021-09-26 이전  4,502     ✔ 성공
09-25 02:00     대화 로그 본문   대출상담봇  90   06-27 이전       892,010   ◐ 부분 처리
                 └ 사유: 1회 처리 상한 도달 — 다음 창에 이어서 처리합니다
09-19 02:15     체인 검증(주간)  —          —     —              412,003   ✔ 정상
```

행 펼침(기존 `AuditLogsPage`의 펼침 패턴 재사용)에 `instanceId`·(파기/감사삭제 실행이면) `headSeq`·`headHash`·`anchorSeq`를 "체인 머리" 보조 정보로 표시한다(외부 대조용 — FR-DG7-7).

### 상태·결과 코드 라벨 매핑

| `status` | 라벨 |
|---|---|
| `SUCCEEDED` | ✔ 성공 |
| `PARTIAL` | ◐ 부분 처리 |
| `FAILED` | ✖ 실패 |

| `resultCode` | 보조 문구 |
|---|---|
| `WINDOW_ENDED` | 실행 창 시간이 끝나 다음 창에 이어서 처리합니다 |
| `MAX_ROWS` | 1회 처리 상한에 도달해 다음 창에 이어서 처리합니다 |
| `LEASE_LOST` | 다른 인스턴스가 작업을 이어받았습니다 |
| `HASH_MISMATCH` | 체인 불일치 — 기록이 변경되었을 수 있습니다 |
| `SEQ_GAP` | 순번 결손 — 기록이 삭제되었을 수 있습니다 |
| `TAIL_MISSING` | 최신 기록 일부가 삭제되었습니다 |
| `KEY_UNAVAILABLE` | 서명 키를 확인할 수 없습니다(키 교체 후 이전 키가 제거됨) |
| `ANCHOR_MISSING` | 검증 시작점을 찾을 수 없습니다 |
| `DB_ERROR` | 처리 중 오류가 발생했습니다 |

`kind='CHAIN_VERIFY'` 행의 "결과"는 위 상태 대신 `ChainVerifyResultBadge`(§3.4와 동일 라벨: 정상/불일치/순번 결손/최신 기록 누락/서명 키 없음/검증 시작점 없음)를 쓴다.

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `RetentionRunListPage` | `GET /governance/retention-runs`(필터·페이지) — `Paginated<RetentionRunItem>` |
| `RetentionRunFilterBar` | `kind`(다중 선택: PURGE/BACKFILL/REENCRYPT/CHAIN_VERIFY) · `chatbotId`(선택 필드) · `DateRangeField` |
| `PurgeRunResultBadge` | `status`, `resultCode?` |
| `RetentionRunDetailRow`(펼침) | `instanceId`, `headSeq?`, `headHash?`, `anchorSeq?` |

---

## 3.4 G2 — 챗봇 보존기간 재정의 (`SettingsTab` 확장, `/chatbots/:chatbotId/settings?section=retention`)

### 목적
챗봇 단위로 대화 원천 4종의 보존기간을 전역과 다르게 지정한다(S-4). ARCHIVED 챗봇도 이 설정은 열람·저장할 수 있다(§8.3 — "설정 데이터"로 취급, 자산이 아님).

### 진입 경로 · 정보구조 판단 — **확정(2026-09-26 PM, §13-1)**

`SettingsTab.tsx`는 현재 하위 탭이 없는 단일 폼 페이지다. **App.tsx 라우트를 바꾸지 않고**, `SettingsTab` 내부에 `SurveyTabs`(`pages/dialogue/components/survey/SurveyTabs.tsx`)와 같은 형태의 서브탭 2개("기본 정보"/"보존기간")를 쿼리스트링(`?section=retention`)으로 추가한다. PM이 2026-09-26 이 방식을 제안대로 확정했다(§13-1). 이유:
1. 챗봇 상세의 최상위 탭 구조(`TabNav.tsx`)는 여러 화면(No.24·No.28·No.40·No.44)이 참조하는 안정된 골격이라 손대지 않는 편이 안전하다.
2. `RestentionSection`은 `chatbot:read`+`security:read`가 있어야 보이므로, `security:read`가 없는 EDITOR에게는 서브탭 자체가 나타나지 않아야 한다(§4 권한별 렌더링) — 쿼리스트링 서브탭이 가장 단순하게 이를 만족한다.
3. 기존 `SettingsTab.spec.tsx`·`TabNav.spec.tsx`(라우트 수 단언)에 영향이 없다.

### 상태별 UI

| 상태 | UI |
|---|---|
| `security:read` 없음(EDITOR 등) | "보존기간" 서브탭 자체가 렌더되지 않음(기본 정보만 노출) |
| 로딩 | `SkeletonRow` × 4 |
| 조회 성공 | §3.4.1 레이아웃 |
| ARCHIVED 챗봇 | **`ArchivedBanner`는 기존 "기본 정보" 서브탭에만 뜨고, "보존기간" 서브탭은 정상 편집 가능**(§8.3) — 대신 이 서브탭 상단에 "보관 상태에서도 보존기간 설정은 변경할 수 있습니다" 안내 1줄 |
| 저장 중 | 버튼 스피너 |
| `400 RETENTION_OUT_OF_RANGE` / `CONFIRM_NAME_MISMATCH` | G1-b와 동일 인라인 오류 |
| `security:write` 없음(EDITOR가 아니라 VIEWER 등, `security:read`만 있는 경우는 이론상 없음 — ADMIN 전용이라 실질적으로 발생하지 않음) | 폼 전체 `disabled` + "읽기 전용" 안내(방어적으로만 구현) |

### 3.4.1 레이아웃

```
[기본 정보] [보존기간]                                (서브탭, role=tablist)

┌ 보존기간 재정의 — 대출 상담봇 ─────────────────────────────────────┐
│ 이 챗봇에만 적용할 보존기간을 지정합니다. 지정하지 않으면 전역 정책을    │
│ 따릅니다. 외부 연동 호출 로그·감사로그는 챗봇별로 지정할 수 없습니다.   │
│                                                                   │
│ 대화 로그 본문                                                     │
│  ◉ 전역 따름(현재 180일)  ○ 직접 지정 [   ]일  ○ 무기한              │
│ 종결 미응답·평가 질문                                               │
│  ○ 전역 따름(현재 180일)  ◉ 직접 지정 [  90]일  ○ 무기한             │
│ 설문 자유 텍스트                                                    │
│  ◉ 전역 따름(현재 무기한)  ○ 직접 지정 [   ]일  ○ 무기한             │
│ 상담 메시지                                                        │
│  ○ 전역 따름(현재 180일)  ◉ 직접 지정 [  60]일  ○ 무기한             │
│                                                                   │
│                                    [변경 내용 확인(미리보기)]         │
│  … (G1-b와 동일한 미리보기 + 확인 문자열 흐름, 확인 문자열 = 챗봇 이름) │
│                                          [취소]  [보존기간 60일로 단축]│
└──────────────────────────────────────────────────────────────────┘
```

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `ChatbotRetentionSection` | `chatbotId` → `GET /chatbots/:chatbotId/retention` |
| `RetentionKindEditor` × 4 | 라디오 3지("전역 따름"/"직접 지정"/"무기한") — G1-b와 같은 컴포넌트, `mode` prop만 `'CHATBOT'` |
| `RetentionConfirmField` | `expected={chatbot.name}` |
| 미리보기·저장 | `POST /chatbots/:chatbotId/retention/preview` → `PUT /chatbots/:chatbotId/retention` |

---

## 3.5 G3 — 이력 관리(감사로그) 확장 (`/settings/audit-logs`)

### 목적
① 해시 체인 무결성을 검증하고 결과를 읽는다(S-6) ② 열람·내보내기 액션을 기존 필터로 조회한다(S-7) ③ 감사 CSV에 체인 정보가 포함됨을 안내한다.

### 상태별 UI(추가분만 — 기존 목록·필터·펼침 상세는 `AuditLogsPage.tsx` 그대로)

| 상태 | UI |
|---|---|
| 검증 패널 접힘(기본) | "무결성 검증" 접이식 섹션 헤더만 보임 |
| 검증 패널 펼침 | `DateRangeField`(기본값: 최근 30일) + [검증] 버튼 |
| 검증 중 | `AsyncJobProgress`(label="검증하는 중…") |
| 검증 성공(정상) | `ChainVerifyResultBadge`(정상) + "412,003행 · 체인 머리 seq 1,882,410 / 9f3a…" + `NFR-DGS7` 보증 범위 문구 |
| 검증 성공(불일치/순번 결손 등) | `ChainVerifyResultBadge`(해당 값) + "seq 1,880,122에서 불일치 — 이후 행 신뢰 불가" |
| `400 AUDIT_RANGE_TOO_WIDE` | `DateRangeField` 인라인 오류(기존 목록 조회와 동일 오류 코드·문구 재사용) |
| 액션 필터 | 기존 다중 선택 드롭다운에 "열람"·"내보내기" 자동 포함(값 추가만, UI 변경 없음) |
| 상세 펼침(기존 `AuditLogDetailPanel`) | `chain` 필드가 있으면 "체인 정보" 소절 추가: seq · 이전 해시(앞 12자 + 전체 복사) · 이 행 해시(앞 12자 + 전체 복사) · 서명 방식("서명 있음(HMAC)"/"서명 없음(SHA-256)") **— 앞 12자+복사 버튼 방식은 2026-09-26 PM 확정(§13-4)** |
| CSV 내보내기 버튼 | 버튼 옆 도움말 아이콘 툴팁: "내보낸 CSV 끝에 체인 검증 결과와 체인 머리가 함께 포함됩니다" |
| G7 배너(§3.10) | 감사로그 목록 페이지 최상단, 기존 보존 고지 배너 바로 아래에 상시 표시(모드 ON일 때) |

### 레이아웃(검증 섹션만 — 기존 목록 위)

```
┌ 무결성 검증 ▾ ──────────────────────────────────────────────────┐
│ 기간: [2026-08-27] ~ [2026-09-26]  (상한 90일)          [검증]     │
│                                                                  │
│ 결과: ✔ 정상 · 412,003행 검증 · 체인 이전 행 1,204건               │
│ 체인 머리: seq 1,882,410 / 9f3a7c…[복사]                          │
│ ⓘ 이 검증은 "기록된 행이 이후 수정·삭제·재배열되지 않았음"을 탐지합니다. │
│   기록 자체가 누락된 경우나, 서명 키 없이 전체를 다시 계산한 위조는     │
│   이 검증만으로 탐지하지 못합니다(외부에 보관한 체인 머리와 대조 필요). │
└──────────────────────────────────────────────────────────────┘
```

`ChainVerifyResultBadge` 값 6종: 정상(`#DCFCE7`/`#166534`,"✔") · 불일치(`#FEE2E2`/`#991B1B`,"✖") · 순번 결손(`#FEE2E2`/`#991B1B`,"✖") · 최신 기록 누락(`#FEE2E2`/`#991B1B`,"✖") · 서명 키 없음(`#FEF3C7`/`#92400E`,"⚠") · 검증 시작점 없음(`#FEF3C7`/`#92400E`,"⚠").

### 컴포넌트 분해

| 컴포넌트 | props / 데이터 바인딩 |
|---|---|
| `AuditChainVerifyPanel` | 접이식 · `from`/`to`(기본 최근 30일) → `POST /audit-logs/verify` → `AuditChainVerifyResponse` |
| `AuditLogDetailPanel`(기존, 확장) | `detail.chain?: { seq, prevHash, rowHash, method }` |
| `AuditLogsPage`(기존, 확장) | 내보내기 버튼 옆 `title` 속성 1줄 추가(신규 컴포넌트 불요) + `GovernanceViewAuditBanner`(§3.10) 삽입 |

---

## 3.6 G4 — API 연결 편집·목록 확장 (`/settings/api-connections`)

### 목적
모드 ON일 때 허용 목록 밖 호스트로 레거시 연결을 저장하지 못하게 막고(S-9), 차단된 호출을 호출 로그에서 식별할 수 있게 한다.

### 상태별 UI(추가분만)

| 상태 | UI |
|---|---|
| `baseUrl` 저장(생성·수정) 시 `400 EGRESS_HOST_NOT_ALLOWED` | `baseUrl` 필드 아래 인라인 오류: "외부 전송 허용 목록에 없는 호스트입니다(서버 설정 필요)" — 기존 `fieldErrorsFromApiError` 매핑이 그대로 처리(details[0].field='baseUrl') |
| 사용 중지(`enabled=false`)·삭제 | 차단과 무관하게 기존대로 허용(오류 없음) |
| 호출 로그 목록·요약(`ApiCallLogPage`) | `outcome=EGRESS_BLOCKED` 행에 `ApiCallOutcomeBadge`(§2.2) |

새 컴포넌트는 없다 — 기존 `ApiConnectionEditModal`의 오류 매핑 파이프라인과 `ApiCallOutcomeBadge` Record 확장만으로 충족된다(§2.4 설계서 "컴파일 강제"와 동일한 이유로, 프론트엔드 구현자는 `ApiCallOutcome` 유니온에 값이 추가되는 순간 TS가 `OUTCOME_TONE`·`MESSAGES.apiCallLogs.outcomeLabel` 누락을 잡아준다).

---

## 3.7 G5 — 파기 표시(횡단)

### 목적
보존기간 경과로 소거된 텍스트를 여러 화면에서 **일관된 문구**로 보여주고("보존기간 경과로 파기됨"), 복호화 실패는 다른 문구("[복호화 실패]")로 구분한다.

### 적용 대상과 규칙

| 화면(기존 파일, 추정) | 적용 지점 | 표시 |
|---|---|---|
| 대화 보기 — `LiveSessionDetailPage`/`TranscriptPanel.tsx`(진행 중·종료 후 재조회 시) | 턴의 `userText`/`botText`에 `purged: true` | 해당 말풍선 텍스트를 `PurgedFieldNotice`로 교체(발신자·시각 라벨은 유지) |
| 상담 이력 상세 — `HandoffHistoryDetailPage` | 메시지 `purged: true` | 동일 |
| 설문 응답 목록·자유 텍스트 목록 — `SurveyResultsPage` 하위 | 답변 `purged: true` | 셀 값을 `PurgedFieldNotice`로 교체(행·건수는 유지) |
| 설문 CSV(RESPONSES) | 서버가 셀 문자열 자체를 "보존기간 경과로 파기됨"으로 내려줌 | 프런트 변경 없음(문자열 그대로 출력) |
| 미응답·부정 평가 상세 — `UnansweredQuestionDetail`류 | 본 항목 `purged: true` 또는 `lastFeedback.purged: true` | 질문/후보 텍스트 자리 `PurgedFieldNotice`, "당시 답변: 보존기간 경과로 파기됨"(EX-DG-11) |
| 진행 중 목록의 마지막 발화(`LiveSessionListPage`) | 소거된 로그가 마지막 발화인 경우 | 동일 |
| 질문 순위(대시보드·통계) | 서버가 소거 행을 집계에서 이미 제외 | **화면 변경 없음**(빈 문자열 항목이 생기지 않으므로 별도 표시 불요) |

복호화 실패(`FR-DG4-4`, `HandoffMessage.text`·`SurveyAnswer.textValue`만 해당 — `rawText`는 §3.8 참고): 서버가 필드 값을 문자열 `"[복호화 실패]"`로 내려준다. 프런트는 이를 일반 텍스트로 출력하되, **`DecryptFailedNotice` 스타일(경고 톤 + `⚠` 아이콘)**을 매칭시켜 `PurgedFieldNotice`(중립 톤)와 시각적으로 구분한다(정확 매칭은 문자열 `"[복호화 실패]"` 감지 또는 서버가 별도 플래그를 줄 수도 있음 — 구현 시 백엔드 응답에 `decryptFailed?: true` 플래그가 있으면 그것을 우선 사용하고, 없으면 리터럴 문자열로 판별).

---

## 3.8 상담 원문(`rawText`) — 암호화·열람 감사와의 관계 (No.24 RawTextToggle 무변경 확인)

기존 `RawTextToggle`·상담 스레드 원문 표시 로직은 **바뀌지 않는다**(§7.8). 이 문서가 명시적으로 확인하는 것:

1. **개봉 실패 시 원문 필드 자체가 응답에서 생략**된다(설계서 §7.8) — 즉 "[복호화 실패]"가 원문 자리에 뜨는 일은 없다. 프런트는 `rawText` 키가 없을 때 지금처럼 "원문 없음/표시 대상 아님"과 동일하게 처리하면 된다(추가 분기 불필요).
2. `RawTextToggle`을 켤 때의 기존 감사 고지("열람이 기록됩니다")는 `RAW_VIEW`(원문 실제 노출)를 가리키는 문구로 **그대로 유효**하다. 거버넌스 모드 ON에서 같은 화면 진입 자체에 대해 별도로 남는 `VIEW`(마스킹본 열람, V-2)는 **§3.10 `GovernanceViewAuditBanner`("이 화면 열람은 감사로그에 기록됩니다")로 고지한다**(**2026-09-26 PM 확정 — 이 문서 최초 초안의 "고지하지 않음" 결정(구 D-5)을 번복**). 두 고지는 문구·트리거가 다르므로, 대화 보기 화면에서 원문 토글을 켜는 순간에는 정적 배너(`GovernanceViewAuditBanner`)와 토글 팝오버("열람이 기록됩니다")가 동시에 보일 수 있다 — 의도된 중복이며 어느 한쪽을 생략하지 않는다.
3. 종료된 상담의 `HANDOFF_TEXT` 소거는 진행 중 상담의 원문 표시와 충돌하지 않는다(EX-DG-9) — 화면 조건 분기 불필요.

---

## 3.9 G6 — 시스템 설정 메뉴 항목 추가

`SystemSettingsMenu.tsx`의 `ITEMS` 배열에 1건 추가:

```
{ label: MESSAGES.systemSettings.dataGovernance, href: '/settings/data-governance', permission: 'security:read' }
```

위치는 "API 연결"(`security:read`) 다음, "이력 관리"(`audit:read`) 앞 — 같은 `security:read` 그룹으로 묶는다.

---

## 3.10 G7 — 열람 감사 안내 배너 (`GovernanceViewAuditBanner`, VIEW 대상 8개 화면) — **신설(2026-09-26 PM 확정)**

### 목적
거버넌스 모드 ON일 때 `VIEW`(마스킹본 열람) 감사가 실제로 기록되는 8개 화면(설계서 §11.3 V-1~V-8) 상단에 짧은 정적 안내를 넣어 "이 화면을 보는 행위가 기록된다"는 사실을 고지한다. 모드 OFF에서는 `VIEW`가 기록되지 않으므로(FR-DG8-3·AC-DG7-3) 배너도 표시하지 않는다. 이 결정은 최초 초안의 D-5(§12)를 **번복**한 것이다.

### 재사용 컴포넌트 지점

새 컴포넌트 `GovernanceViewAuditBanner`(`components/GovernanceViewAuditBanner.tsx`)는 **기존 정적 info 배너 마크업**을 그대로 재사용한다 — `pages/settings/AuditLogsPage.tsx` 156행의 보존 고지 배너와 동일한 형태다.

```tsx
// components/GovernanceViewAuditBanner.tsx
export function GovernanceViewAuditBanner({ visible }: { visible: boolean }): JSX.Element | null {
  if (!visible) return null;
  return <p className="form-banner form-banner--info">{MESSAGES.dataGovernance.viewAuditBanner}</p>;
}
```

**`components/EnvironmentScopeNotice.tsx`(`role="status"`, 암묵적 라이브 리전) 패턴은 의도적으로 쓰지 않는다** — PM이 "정적 텍스트로 두고 live region을 쓰지 않는다"를 확정했기 때문이다(§접근성 규칙). 재사용 대상은 어디까지나 **마크업/클래스**(`.form-banner.form-banner--info`)이지, `role`이 있는 배너 컴포넌트가 아니다.

### 8개 화면과 삽입 위치 (설계서 §11.3 V-1~V-8 대응)

| # | 화면(파일, 추정) | 대응 열람 감사 | 삽입 위치 |
|---|---|---|---|
| 1 | 진행 중 세션 목록 — `LiveSessionListPage` | V-1 | 페이지 제목 아래, 필터바 위(다른 상시 배너 없음 — 최상단) |
| 2 | 대화 보기(진행 중/종료) — `LiveSessionDetailPage`/`TranscriptPanel.tsx` | V-2 | 세션 헤더 아래, 대화 로그(`role="log"`) 영역 위 |
| 3 | 상담 이력 상세 — `HandoffHistoryDetailPage` | V-3 | 상세 헤더 아래, 메시지 목록 위 |
| 4 | 설문 응답 목록 — `SurveyResultsPage`(응답 탭) | V-4 | 탭 콘텐츠 최상단, 필터바 위 |
| 5 | 설문 자유 텍스트 목록 — `SurveyResultsPage`(자유 텍스트 탭) | V-5 | 4와 같은 페이지의 다른 탭 — 탭 콘텐츠 영역 상단에 배치(탭 전환 시 배너도 함께 전환) |
| 6 | 미응답·부정 평가 상세 — `UnansweredQuestionDetail`(상세 패널/모달) | V-6 | 패널 상단, 질문 본문 위 |
| 7 | 감사로그 목록 — `AuditLogsPage`(목록) | V-7 | 기존 보존 고지 배너(`retentionNotice`) **바로 아래**(정적 배너 2개를 세로로 병기) |
| 8 | 감사로그 상세(펼침) — `AuditLogsPage`(펼침 상세) | V-8 | 7과 같은 페이지 — **별도 배너를 다시 넣지 않는다**(목록 진입 시점에 이미 노출됨, 펼침은 같은 방문의 연장) |

**기존 배너와의 배치 우선순위**: `ArchivedBanner`/`ScheduleConflictBanner` 등 경고성 배너가 있으면 그 다음에, 없으면 페이지 최상단에 이 배너를 둔다. `PurgedFieldNotice`(§3.7)는 개별 항목 단위 표시라 이 배너와 위치가 겹치지 않는다.

### 노출 조건

`visible = governanceModeOn`(해당 화면이 위 8개 목록에 있다는 전제하에서만 렌더 — 권한이 없어 화면 자체가 안 보이면 배너도 당연히 렌더되지 않는다).

### 문구

`MESSAGES.dataGovernance.viewAuditBanner` = **"이 화면 열람은 감사로그에 기록됩니다."**

### 접근성 규칙(PM 확정)

- **정적 텍스트로만 둔다 — `role="status"`·`role="alert"`·`aria-live` 속성을 쓰지 않는다.** 페이지 로드 시 DOM에 이미 존재하는 일반 문단(`<p>`)으로 렌더되며, 스크린리더는 페이지 진입 시 다른 정적 콘텐츠와 같은 순서로 읽는다 — 별도의 낭독 이벤트를 발생시키지 않는다.
- 탭 전환(4↔5, 설문 응답/자유 텍스트)으로 배너가 다시 마운트되어도 **재알림으로 취급하지 않는다**(라이브 리전이 아니므로 애초에 발생하지 않음). `UIUX_준수기준.md` §8의 "새 항목만 `aria-live`로 1회 안내" 원칙은 **이 배너에는 적용하지 않는다** — PM이 명시적으로 라이브 리전을 배제했으므로, §8 일반 원칙에 대한 **의도된 예외**로 이 문서에 기록한다.
- 색상만으로 의미를 전달하지 않는다(§1) — 문구 자체가 의미를 전달하므로 별도 아이콘·색상 규칙 없이 기존 `.form-banner--info` 중립 안내 톤을 그대로 쓴다.
- 폴링 갱신(대화 보기 2초·진행 중 목록 5초)이 있는 화면에서도 배너는 **폴링 응답 데이터가 아니라 페이지/세션 진입 시 1회 계산되는 `governanceModeOn` 값**에 바인딩한다 — 매 폴링마다 배너 DOM을 재생성하지 않는다(불필요한 리렌더·깜빡임 방지).

### 데이터 소스 — `governanceModeOn` 플래그(신규 의존성, 확인 필요 — §11·§12 D-6)

이 배너는 8개 화면 각각에서 판단돼야 하는데, 그중 상담 이력 상세(AGENT 접근)·설문 응답 목록(EDITOR 접근)·미응답 상세(EDITOR 접근) 등은 **`security:read` 권한이 없는 역할도 접근**한다. 따라서 `GET /governance/map`(`security:read` 전용)을 이 화면들에서 직접 호출할 수 없다. 이 문서는 **`GET /auth/me` 응답에 `governanceModeOn: boolean` 필드를 추가**해 `AuthContext`가 로그인 시 1회 읽고 전역으로 제공하는 방식을 제안한다(민감하지 않은 ON/OFF 값만 노출 — 허용 목록·키 등은 포함하지 않는다). 이는 설계서 §15에 없는 신규 API 의존성이므로 **backend-implementer/system-architect 확인이 필요**하다(다른 대안: 별도의 permission-free 상태 엔드포인트).

---

## 4. 사용자 인터랙션 흐름 종합

### 4.1 데이터 지도로 심사 대응 (S-2)
```
SystemSettingsMenu에서 "데이터 거버넌스" 클릭 → G1(데이터 지도) 로드
→ GET /governance/map(1회) → 카드 6개 렌더 → (필요 시) 화면 캡처/인쇄
```
오류 시 `ErrorState` 재시도. 모드 OFF는 배너만 다를 뿐 같은 흐름.

### 4.2 전역 보존기간 단축 (S-3)
```
G1-b 진입 → GET retention → 폼에 현재값 채움
→ 사용자가 "대화 로그 본문" 90일로 변경 → [변경 내용 확인]
→ POST preview → 결과 표 + 확인문구 노출 → "보존기간 단축" 입력
→ [보존기간 90일로 단축] → PUT retention(confirmText 포함)
→ 성공: 폼 재초기화 + "적용 예정" 블록 + Toast + aria-live 1회
   실패(RETENTION_OUT_OF_RANGE): 해당 필드 인라인 오류, 포커스 이동
   실패(CONFIRM_NAME_MISMATCH): 확인 필드 인라인 오류, 포커스 이동
```

### 4.3 자동 파기 확인 (S-5)
```
(백그라운드 — 사용자 액션 없음) → 다음날 G1-c 진입 → GET retention-runs
→ 최신 행에 "09-26 02:00 · 대화 로그 본문 · 전 챗봇 · 1,190,002행 · 성공"
→ (선택) 대시보드로 이동해 대화 수 통계가 그대로임을 확인 — 이 그룹이 만드는 화면 아님(기존 통계 화면)
```

### 4.4 감사 체인 검증 (S-6)
```
G3 진입 → "무결성 검증" 섹션 펼침 → 기간 확인(기본 30일) → [검증]
→ AsyncJobProgress("검증하는 중…") → 성공: ChainVerifyResultBadge + 요약
  실패(AUDIT_RANGE_TOO_WIDE): DateRangeField 인라인 오류
```

### 4.5 열람·내보내기 감사 확인 (S-7)
```
(다른 화면에서 EDITOR가 상담 이력 상세를 봄 — 진입 즉시 GovernanceViewAuditBanner가
 "이 화면 열람은 감사로그에 기록됩니다"를 보여줌, 사용자 추가 조작 없이 백그라운드로 VIEW 기록)
→ ADMIN이 G3 진입 → 액션 필터에서 "열람" 선택 → 목록에 "열람 · 상담 #a1b2 · EDITOR 박○○" 확인
```

### 4.6 레거시 연결 저장 차단 (S-9)
```
ApiConnectionsPage → [연결 추가] → baseUrl에 허용 목록 밖 호스트 입력 → 저장
→ 400 EGRESS_HOST_NOT_ALLOWED → baseUrl 필드 인라인 오류, 모달 유지(포커스 그 필드로)
```

### 4.7 오류 처리 요약표

| 오류 코드 | 화면 | 처리 |
|---|---|---|
| `EGRESS_HOST_NOT_ALLOWED`(400) | G4 연결 저장 | `baseUrl` 필드 인라인 오류 |
| `RETENTION_OUT_OF_RANGE`(400) | G1-b·G2 저장/미리보기 | 해당 종류 입력 인라인 오류 + 허용 범위 문구 |
| `CONFIRM_NAME_MISMATCH`(400, 재사용) | G1-b·G2 저장 | 확인 문자열 필드 인라인 오류 |
| `AUDIT_RANGE_TOO_WIDE`(400, 재사용) | G3 검증·기존 목록 조회 | `DateRangeField` 인라인 오류(기존과 동일) |
| `AGGREGATION_TIMEOUT`(503, 재사용) | G1-b·G2 미리보기 | 미리보기 영역 `ErrorState`(재시도) |
| `404`(대기 중 단축 없음) | G1-b·G2 "예정된 단축 전체 취소" | 버튼 자체가 대기 항목 없을 때 렌더되지 않으므로 실사용자에게는 노출되지 않음(방어적으로만 처리) |
| `403 PERMISSION_DENIED` | G1/G1-b/G1-c/G2/G3 검증 | 기존 `ForbiddenState`/`RequirePermission` 패턴 |

---

## 5. 권한별 화면 요소

| 역할 | G1 데이터 지도 | G1-b 보존 정책 | G1-c 파기 이력 | G2 챗봇 재정의 | G3 검증 | G4 연결 편집 | G7 열람 배너 |
|---|---|---|---|---|---|---|---|
| ADMIN | 조회 | 조회+저장 | 조회 | 조회+저장 | 실행 | 편집+차단 오류 확인 | 8개 화면에서 모드 ON이면 노출 |
| EDITOR | 진입 불가(403) | 진입 불가 | 진입 불가 | 서브탭 미노출 | 검증 불가(패널 숨김) | 기존 권한대로 | 접근 가능한 화면(상담 상세·설문 응답 등)에서 모드 ON이면 노출 |
| VIEWER | 진입 불가 | 진입 불가 | 진입 불가 | 서브탭 미노출 | 검증 불가 | — | 접근 가능한 화면에서 모드 ON이면 노출 |
| AGENT | 진입 불가 | 진입 불가 | 진입 불가 | 서브탭 미노출 | 검증 불가 | — | 상담 관련 화면에서 모드 ON이면 노출 |

- `security:read`도 `audit:read`도 없는 역할에게 G3의 "무결성 검증" 섹션 자체가 렌더되지 않는다(목록·내보내기는 기존 `audit:read` 게이트 그대로).
- G1~G1-c는 전부 ADMIN 전용(현재 권한 매핑상 `security:read/write`·`audit:read`는 ADMIN에게만 부여 — 설계서 §14). 신규 권한·역할 0종.
- G7 배너는 **권한과 무관하게 "모드 ON + 화면이 8개 목록에 있음"만으로 노출**된다(별도 권한 게이트 없음 — 배너 자체는 어떤 데이터도 새로 노출하지 않는 정적 문구이기 때문).

---

## 6. 상태별 화면(로딩/빈/오류) 총정리

| 화면 | 로딩 | 빈 상태 | 오류 |
|---|---|---|---|
| G1 데이터 지도 | `SkeletonRow` × 6 | 없음(항상 값이 있음 — 설정 안 된 항목은 "미설정"으로 표시) | `ErrorState` |
| G1-b 보존 정책 | `SkeletonRow` × 6 | 없음(항상 6종 기본값 "무기한") | `ErrorState`(조회) / 인라인(저장) |
| G1-c 파기 이력 | `SkeletonRow` × 5 | `EmptyState`("파기 실행 이력 없음") | `ErrorState` |
| G2 챗봇 재정의 | `SkeletonRow` × 4 | 없음(항상 4종 기본값 "전역 따름") | `ErrorState`/인라인 |
| G3 검증 패널 | `AsyncJobProgress` | — | 인라인(`DateRangeField`) |
| G7 열람 배너 | 없음(로딩 상태 없이 `governanceModeOn` 확정 즉시 렌더 여부 결정) | — | 없음(플래그 조회 실패 시 안전 측 `false`로 처리 — 배너 미노출) |

---

## 7. `messages.ts` 키 설계 (`apps/web/src/constants/messages.ts`)

```ts
systemSettings: {
  // ...기존...
  dataGovernance: '데이터 거버넌스',
},

dataGovernance: {
  tabMap: '데이터 지도',
  tabRetention: '보존 정책',
  tabPurgeHistory: '파기 이력',
  modeOffBanner: '거버넌스 모드 꺼짐 — 외부 전송 통제·필드 암호화·열람 감사가 적용되지 않습니다.',
  // (2026-09-26 PM 확정 신설) G7 GovernanceViewAuditBanner 전용 — 정적 텍스트, aria-live 없음(§3.10).
  viewAuditBanner: '이 화면 열람은 감사로그에 기록됩니다.',

  map: {
    title: '데이터 지도',
    modeLabel: '거버넌스 모드',
    modeOn: '켜짐',
    modeOff: '꺼짐',
    storageLocationLabel: '저장 위치',
    allowedDirsLabel: '허용 저장 경로',
    residencyNotConfigured: '저장 경로 제한이 설정되지 않았습니다 — 서버 환경변수로 설정할 수 있습니다.',
    diskEncryptionLabel: '디스크 암호화(운영자 신고값)',
    diskEncryptionHint: '이 값은 운영자가 직접 신고한 것이며, 애플리케이션이 실제로 검증하지 못합니다.',
    egressSectionTitle: '외부 전송(출구)',
    egressJudgement: { ALLOWED: '허용', BLOCKED: '차단', NOT_SET: '설정 안 됨', NOT_ENFORCED: '모드 꺼짐 — 집행 안 함' },
    rawTextOffHostWarning: (host: string) => `임베딩: 질의 원문이 이 서버 밖으로 전송됩니다(허용 호스트 ${host}).`,
    encryptionSectionTitle: '필드 암호화',
    encryptionProtectedScope: '보호 범위: 데이터베이스 파일·백업·내보낸 사본이 유출된 경우',
    encryptionUnprotectedScope: '보호하지 못하는 범위: 서버 자체 또는 환경변수 접근 권한이 있는 경우',
    plaintextRemaining: (n: number) => `평문 잔존: ${n.toLocaleString()}행`,
    retentionSectionTitle: '보존 현황',
    auditChainSectionTitle: '감사 체인',
    residualRiskSectionTitle: '잔존 위험 점검',
    v1TokenSummary: (nodes: number, snapshots: number, checkedAt: string) =>
      `v1 노드 평문 토큰: ${nodes}개 노드 · ${snapshots}개 스냅샷(점검 시각 ${checkedAt})`,
    v1TokenRemovalHint: '제거 방법: 노드를 v2로 전환하거나 해당 버전을 삭제하세요.',
    loadFailed: '데이터 지도를 불러오지 못했습니다.',
  },

  retention: {
    title: '보존 정책',
    kindLabels: {
      CONVERSATION_TEXT: '대화 로그 본문',
      UNANSWERED_CLOSED: '종결 미응답·평가 질문',
      SURVEY_FREE_TEXT: '설문 자유 텍스트',
      HANDOFF_TEXT: '상담 메시지',
      CALL_LOGS: '외부 연동 호출 로그',
      AUDIT_LOGS: '감사로그',
    },
    followGlobalLabel: (days: string) => `전역 따름(현재 ${days})`,
    customLabel: '직접 지정',
    unlimitedLabel: '무기한',
    minDaysHint: (n: number) => `최소 ${n}일`,
    previewButton: '변경 내용 확인',
    previewLoadFailed: '변경 영향을 확인하지 못했습니다.',
    previewNotice: '통계 수치는 변하지 않습니다. 이미 파기된 텍스트는 되돌릴 수 없습니다.',
    affectedRowsText: (kind: string, days: number, count: number, date: string) =>
      `${kind}: ${days}일로 단축 → ${count.toLocaleString()}행 · ${date}(유예 7일)부터 파기됨`,
    confirmRequiredHint: '단축이 포함되어 있습니다 — 계속하려면 아래에 확인 문구를 입력하세요.',
    confirmLabelGlobal: '"보존기간 단축"을 입력하세요',
    confirmMismatchGlobal: '"보존기간 단축"과 일치하지 않습니다.',
    confirmLabelChatbot: (name: string) => `"${name}"을(를) 입력하세요`,
    confirmMismatchChatbot: (name: string) => `"${name}"과(와) 일치하지 않습니다.`,
    shortenConfirmButton: (days: number) => `보존기간 ${days}일로 단축`,
    saveButton: '저장',
    saveSuccess: '보존 정책이 저장되었습니다.',
    scheduleSuccess: (date: string) => `보존 정책 변경이 예약되었습니다 — ${date}부터 적용됩니다.`,
    pendingSectionTitle: '적용 예정(대기 중)',
    pendingItemText: (kind: string, days: number, date: string) => `${kind} ${days}일 → ${date}부터 적용`,
    cancelAllPendingButton: '예정된 단축 전체 취소',
    cancelAllPendingHint: '이 버튼은 대기 중인 모든 단축을 취소합니다.',
    cancelAllPendingSuccess: '예정된 단축을 취소했습니다.',
    outOfRangeError: (min: number, max: number) => `허용 범위: ${min}~${max}일`,
    overridesSectionTitle: '챗봇별 재정의',
    overridesEmptyTitle: '챗봇별 재정의가 없습니다.',
  },

  purgeHistory: {
    title: '파기 이력',
    emptyTitle: '아직 파기 실행 이력이 없습니다.',
    emptyDesc: '보존 정책이 전부 무기한이면 파기할 대상이 없습니다.',
    columnStartedAt: '실행 시각',
    columnKind: '종류',
    columnTarget: '대상',
    columnDays: '일수',
    columnCutoff: '기준 시각',
    columnAffectedCount: '처리 건수',
    columnStatus: '결과',
    status: { SUCCEEDED: '성공', PARTIAL: '부분 처리', FAILED: '실패' },
    resultCode: {
      WINDOW_ENDED: '실행 창 시간이 끝나 다음 창에 이어서 처리합니다',
      MAX_ROWS: '1회 처리 상한에 도달해 다음 창에 이어서 처리합니다',
      LEASE_LOST: '다른 인스턴스가 작업을 이어받았습니다',
      HASH_MISMATCH: '체인 불일치 — 기록이 변경되었을 수 있습니다',
      SEQ_GAP: '순번 결손 — 기록이 삭제되었을 수 있습니다',
      TAIL_MISSING: '최신 기록 일부가 삭제되었습니다',
      KEY_UNAVAILABLE: '서명 키를 확인할 수 없습니다(키 교체 후 이전 키가 제거됨)',
      ANCHOR_MISSING: '검증 시작점을 찾을 수 없습니다',
      DB_ERROR: '처리 중 오류가 발생했습니다',
    },
    loadFailed: '파기 이력을 불러오지 못했습니다.',
  },

  chainVerify: {
    sectionTitle: '무결성 검증',
    verifyButton: '검증',
    verifying: '검증하는 중…',
    result: {
      OK: '정상',
      HASH_MISMATCH: '불일치',
      SEQ_GAP: '순번 결손',
      TAIL_MISSING: '최신 기록 누락',
      KEY_UNAVAILABLE: '서명 키 없음',
      ANCHOR_MISSING: '검증 시작점 없음',
    },
    checkedRowsText: (n: number) => `${n.toLocaleString()}행 검증`,
    preChainRowsText: (n: number) => `체인 이전 행 ${n.toLocaleString()}건`,
    headText: (seq: number, hash: string) => `체인 머리: seq ${seq} / ${hash}`,
    mismatchDetail: (seq: number) => `seq ${seq}에서 불일치 — 이후 행 신뢰 불가`,
    guaranteeScopeNotice:
      '이 검증은 "기록된 행이 이후 수정·삭제·재배열되지 않았음"을 탐지합니다. 기록 자체가 누락된 경우나 서명 키 없이 전체를 다시 계산한 위조는 이 검증만으로 탐지하지 못합니다.',
    exportHint: '내보낸 CSV 끝에 체인 검증 결과와 체인 머리가 함께 포함됩니다.',
  },

  purgedText: '보존기간 경과로 파기됨',
  decryptFailedText: '[복호화 실패]',
  archivedRetentionHint: '보관 상태에서도 보존기간 설정은 변경할 수 있습니다.',
},

// auditLogs(기존)에 추가
auditLogs: {
  // ...기존...
  chainInfoTitle: '체인 정보',
  chainSeqLabel: 'seq',
  chainPrevHashLabel: '이전 해시',
  chainRowHashLabel: '이 행 해시',
  chainMethodSigned: '서명 있음(HMAC)',
  chainMethodUnsigned: '서명 없음(SHA-256)',
},

// pages/settings/api-connections 관련(기존 apiConnections)
apiConnections: {
  // ...기존...
  // EGRESS_HOST_NOT_ALLOWED는 서버 메시지를 그대로 인라인 오류에 표시(신규 메시지 키 불요)
},

// apiCallLogs.outcomeLabel(기존 Record 확장)
apiCallLogs: {
  outcomeLabel: {
    // ...기존 17종...
    EGRESS_BLOCKED: '외부 전송 차단',
  },
},
```

---

## 8. `UIUX_준수기준.md` 체크리스트 매핑

| 화면 | 항목 | 반영 |
|---|---|---|
| G1 데이터 지도 | §1 색상 단독 금지 | `EgressJudgementBadge`·`ChainVerifyResultBadge` 전부 텍스트+아이콘 병행(NFR-DGA1) |
| G1-b·G2 저장 확인 | §3 키보드 접근성 + §6 폼 | `ConfirmDialog` 포커스 트랩·Esc 취소(저장 중에는 `closeOnEsc={!saving}`) · 라디오(전역따름/직접지정/무기한) 방향키 탐색 · 필수/선택 구분(일수 입력은 선택 상태에 종속) |
| G1-b·G2 확인 문자열 | §6 폼 컨트롤 · §7 오류 메시지 | `RetentionConfirmField` — 불일치 시 인라인 오류, 저장 버튼은 값 일치 전까지 비활성(`aria-disabled`) |
| G1-b·G2 저장 결과 | NFR-DGA3 | 영향 미리보기는 표 형태 텍스트, 저장 성공은 `aria-live="polite"` 1회 |
| G1-b 단축 확인 버튼 | NFR-DGA2 | 버튼 이름을 "보존기간 N일로 단축"으로 명시(추상적 "확인" 금지) |
| G5 파기 표시 | NFR-DGA4 | `PurgedFieldNotice`가 회색 스타일만이 아니라 "보존기간 경과로 파기됨" 텍스트를 항상 동반 |
| G3 검증 진행 | §8 로딩/상태 피드백 | `AsyncJobProgress`(시각적 진행 + `aria-live`) |
| G3 결과 | §7 오류 메시지 | `AUDIT_RANGE_TOO_WIDE`는 기존 목록 조회와 동일한 인라인 위치·문구 재사용(일관성) |
| G1-c 표/모바일 | §9 내비게이션, §3 표 헤더 | 기존 `AuditLogCard`류 데스크톱 표 + 모바일 카드 이중 렌더 패턴 재사용, 페이지네이션 밑줄+형태 구분 |
| G6 메뉴 항목 | §9 내비게이션 | `Link` href 기반(`SystemSettingsMenu` 기존 패턴 그대로) |
| G2 진입 | §1 "민감 정보 임시 열람 토글" 원칙과의 구분 | 이 화면은 "토글"이 아니라 "설정값 변경"이라 열람 고지 규칙(§1 마지막 항목)이 직접 적용되지 않음 — 대신 저장 시 확인 문자열 재입력으로 오조작을 막는다(다른 원칙, §6 폼 컨트롤 근거) |
| **G7 열람 감사 배너** | §1 "민감 정보 임시 열람 토글" 원칙의 확장 적용 · §8 로딩/상태 피드백의 **의도된 예외** | 8개 화면 상단 정적 배너로 §1의 고지 원칙을 "토글"이 아닌 "수동 열람 화면"에도 확장 적용한다(2026-09-26 PM 확정). 단 §8이 일반적으로 요구하는 `aria-live` 갱신 안내는 **PM이 명시적으로 배제**했으므로 정적 텍스트로만 두고, 이 예외를 문서로 남긴다(§3.10 접근성 규칙) |

---

## 9. 반응형 고려사항

- 모든 신규 화면은 **관리자 콘솔 전용**이며 `apps/widget`은 대상이 아니다.
- 데스크톱(≥1024px): §3의 ASCII 레이아웃대로 카드/표 그대로.
- 태블릿(768~1023px): 카드 2열 → 1열, 표는 가로 스크롤 컨테이너(`dialogue-table-wrap` 기존 클래스 재사용).
- 모바일(≤767px): `AuditLogCard`/`AuditLogCardList` 선례와 같은 방식으로 각 표(출구 목록·파기 이력·챗봇 재정의 목록)를 카드 리스트로 전환한다. 보존기간 라디오군은 세로 스택 유지(이미 세로 배치 원칙, §6). 버튼 터치 영역은 기존 `.btn` 클래스가 44×44px 기준을 만족(UIUX §4) — 신규 버튼도 같은 클래스를 사용한다.
- `RetentionKindEditor`의 숫자 입력 폭은 고정(최대 4자리, 3650 상한)이라 컨테이너 전체 너비를 강제하지 않는다(§5 "입력 길이를 예측할 수 없는 경우"에는 해당하지 않음).
- `GovernanceViewAuditBanner`는 폭에 관계없이 한 줄 문구라 별도 반응형 처리가 필요 없다(긴 화면 폭에서도 줄바꿈 없이 자연스럽게 개행되도록 컨테이너 전체 너비를 쓴다).

---

## 10. Out of scope / 재검토 트리거

- 콘솔에서 모드·출구 허용 목록·암호화 켜기/끄기·키·하한·마스킹 강도를 바꾸는 화면 — **영구적으로 콘솔에 없음**(P-4, 환경변수 전용). 재검토 없음.
- 감사 전용 역할(AUDITOR) 화면 분리 — 2차(ADR-0015 트리거).
- 정보주체 파기 요청 접수 화면 — 2차.
- SIEM 연동 설정 화면 — 2차.
- 대화로그 본문·미응답 큐 텍스트의 암호화 상태 표시 — 2차(1차 암호화 대상 아님).
- 멀티테넌시(챗봇 그룹별 접근 제한) 화면 — 별도 그룹(T-15).

---

## 11. 다음 단계 인계 (`frontend-implementer`)

1. `packages/shared-types`에 `GovernanceMapResponse`·`RetentionPolicyResponse`·`RetentionPreviewResponse`·`RetentionRunItem`·`AuditChainVerifyResponse`·`RetentionTargetKind` 등이 먼저 정의되어 있어야 한다(backend-implementer 선행).
2. `AUDIT_ACTION_LABELS`·`AUDIT_TARGET_LABELS`(shared-types)에 `VIEW`·`EXPORT` 및 신규 `AuditTargetType` 6종이 추가되면, `AuditActionBadge`(`AUDIT_ACTION_COLOR`)와 이 문서 §2.2의 톤을 그대로 적용한다.
3. `ApiCallOutcome`에 `EGRESS_BLOCKED`가 추가되면 `OUTCOME_TONE`·`MESSAGES.apiCallLogs.outcomeLabel`에 §2.2·§7의 값을 더한다(TS가 누락을 컴파일 오류로 잡는다).
4. G1~G1-c의 API 클라이언트(`api/governance.ts` 가칭)는 기존 `api/auditLogs.ts`·`api/deploySchedules.ts` 패턴(fetch 래퍼 + `ApiError`)을 따른다.
5. `RetentionKindEditor`·`RetentionConfirmField`·`RetentionPreviewTable`은 G1-b·G2 공용이므로 먼저 만들고 두 화면이 import하게 한다(중복 구현 금지).
6. §3.4의 서브탭(쿼리스트링) 방식은 2026-09-26 PM이 확정했다(§13-1) — 추가 재상의 불필요.
7. **`governanceModeOn` 플래그**(§3.10)를 `GET /auth/me` 응답에 추가할지, 다른 방식(별도 permission-free 상태 엔드포인트 등)으로 제공할지 backend-implementer/system-architect가 확인해야 한다 — 이 문서는 `GET /auth/me` 확장을 기본 제안으로 둔다.

---

## 12. 설계서와 다르게 판단했거나 설계서에 없어 가정한 사항 (ui-designer 판단 기록)

| # | 판단 | 근거 |
|---|---|---|
| D-1 | "챗봇 설정 > 보존기간 탭"(설계서 §20)을 **App.tsx 라우트 변경 없는 쿼리스트링 서브탭**(`?section=retention`)으로 구현 | `TabNav.tsx`·`SettingsTab.spec.tsx` 등 기존 안정 골격을 건드리지 않기 위함(§3.4 참고). **확정(2026-09-26 PM, §13-1)** |
| D-2 | `POST …/retention/preview`의 요청 본문을 설계서 §15.1 표기 `{ days }`(단일 값처럼 보임) 대신 **6종(또는 4종) 전체 맵**으로 해석 | §8.4 "종류별 `affectedCount`"와 부합하려면 여러 종류를 한 번에 미리보기해야 함. 백엔드 실제 계약과 다르면 프런트 요청 바디만 수정하면 되는 낮은 리스크 |
| D-3 | 감사 CSV 안내는 툴팁 텍스트로만 노출(별도 모달·페이지 없음) | 설계서 §11.4가 요구하는 것은 "동봉"이지 "사전 안내 UI"가 아님 — 최소한으로 처리 |
| D-4 | G1-b/G2의 "전역 따름" 라디오에 현재 유효 일수를 괄호로 병기(예: "전역 따름(현재 180일)") | UIUX §6 "기본값 임의 선택 금지"와 별개로, 사용자가 무엇을 따르는지 알아야 오조작을 막을 수 있다는 판단(요구사항에 명시 없음) |
| ~~D-5~~ | ~~`VIEW`(마스킹본 열람) 기록에 대해 화면에 실시간 고지를 하지 않기로 결정~~ | **번복(2026-09-26 PM)** — §3.10 `GovernanceViewAuditBanner`로 8개 화면에 정적 배너 고지를 신설한다(라이브 리전 미사용). 최초 판단 근거는 "요구사항에 고지 문구 없음"이었으나, PM이 §1의 민감정보 열람 토글 고지 원칙을 수동 열람 화면에도 확장 적용하기로 확정했다 |
| D-6 | `governanceModeOn` 판정 소스를 `GET /auth/me` 응답 확장(신규 필드)으로 가정 | 설계서 §15에 없는 의존성 — 8개 화면 중 일부는 `security:read`가 없는 역할도 접근해 `GET /governance/map`을 호출할 수 없다(§3.10). backend-implementer 확인 필요(§11-7) |

---

## 13. 사용자 확인이 필요한 UX 선택 — **전 항목 확정(2026-09-26 PM)**

아래 4개 항목은 최초 초안에서 "사용자 확인 필요"로 남겼던 것이며, PM이 2026-09-26 전부 제안대로(또는 §1 지시대로) 확정했다. 논의 이력을 남기기 위해 원 문구는 유지하고 확정 표시만 병기한다.

1. **G2 진입 방식**: "챗봇 설정 > 보존기간 탭"을 URL이 실제로 바뀌는 별도 라우트로 만들지, 쿼리스트링 서브탭으로 둘지. → **확정(2026-09-26 PM): 쿼리스트링 서브탭 `?section=retention`으로 진행한다**(§3.4).
2. **`VIEW`(마스킹본 열람) 감사의 화면 내 고지 여부**: 8개 화면에 상시 배너를 넣을지, 조용히 기록만 하고 감사로그에서만 드러나게 할지. → **확정(2026-09-26 PM): 배너를 추가한다.** §3.10 `GovernanceViewAuditBanner`("이 화면 열람은 감사로그에 기록됩니다")를 모드 ON일 때만 노출하고, 정적 텍스트로 두며 `aria-live`는 쓰지 않는다.
3. **"예정된 단축 전체 취소" 버튼의 UX**: 개별 종류가 아니라 전체를 한 번에 취소하는 동작을 그대로 노출할지. → **확정(2026-09-26 PM): 현재 안(§3.2)대로 진행 — 버튼 라벨·도움말 문구로 "전체 취소"임을 명확히 표시한다.**
4. **감사로그 상세의 체인 해시 표시 범위**: 앞 12자 + 전체 복사 버튼 vs 전체 노출. → **확정(2026-09-26 PM): 앞 12자 + 전체 복사 버튼(§3.5) 그대로 진행한다.**

### 13.1 이번 반영으로 새로 생긴 확인 필요 사항

- **`governanceModeOn` 판정 소스**(§3.10 "데이터 소스" 참고): 이 문서는 `GET /auth/me` 응답 확장을 기본 제안으로 가정했다(D-6). 다른 방식(예: 별도 permission-free 상태 엔드포인트, 각 화면 API 응답에 필드 동봉 등)을 원하면 system-architect/backend-implementer 확인이 필요하다.

---

## 14. 변경 이력

| 일자 | 내용 |
|---|---|
| 2026-09-26 | 최초 작성 — No.45 데이터 거버넌스 P-1~P-12 전추천안 확정 반영 |
| 2026-09-26 | PM 결정 반영 — ①D-5 번복: §3.10 `GovernanceViewAuditBanner` 신설(모드 ON에서 VIEW 대상 8개 화면에 정적 안내, live region 미사용) ②§13의 1·3·4번 항목을 제안대로 확정 표기 ③관련 컴포넌트 표(§2.3)·messages.ts(§7)·UIUX 매핑(§8)·권한표(§5)·인계 목록(§11)·판단 기록(§12) 갱신. 코드 변경 없음(문서만) |
