# 레거시 API 연동 (요구사항 정의서)

> **대상 기능**: `docs/01-requirements/기능요구사항.md` §3(확장기능)
> | No | 기능 그룹 | 기능명 | 카탈로그 GPU | 이번 범위에서의 역할 | **재확인 GPU** |
> |---|---|---|---|---|---|
> | 26 | 연동/확장 | 레거시 API 연동 | 1 | **`API_CONDITION` 아웃풋 실행.** 관리자가 등록한 **API 연결(전역 레지스트리)** 로 GET/POST를 호출하고, 응답의 지정 경로 값을 **같은 턴의 출력 치환과 조건 분기**에 쓴다. 엔진은 순수·동기를 유지한다(정지점 → API 계층 실행 → 엔진 재진입). 외부 출구 1개 클래스 · SSRF 다층 방어 · 시크릿은 노드에 두지 않음 · `ApiCallLog` 신설(메타데이터만) | **1 유지** — §4.12 |
>
> **이 그룹 종합 GPU 필요도: 1** (HTTP 1회 · JSON 파싱 · 경로 추출 · 문자열 치환뿐이다. 새 모델·추론·임베딩 0건)
> **구축형 ○ / 구독형 ○(전제조건 있음)** — 구축형은 이 기능의 주 무대다(사내 레거시 접근 = 사설 대역 allowlist). 구독형은 고객 레거시가 **인터넷 경유 HTTPS로 도달 가능**해야 하며 고객 방화벽에 우리 **고정 송신 IP** 등록이 필요하다(§4.11)
>
> **선행 문서**: `docs/01-requirements/기능요구사항.md`(§1 GPU 구간 · §3 No.26 원문 63행 · No.5 37행 · No.39 81행 · No.41 90행 · No.45 94행), `docs/02-spec/개발명세서.md`(§3 174·198행 `ApiCallLog` 분리 예고 · §5 성능 279~282행 · §5 보안 288~291행 · §5 확장성 299행), `docs/03-design/UIUX_준수기준.md`
> **선행 그룹(공통 규약 상속)**: `chatbot-operations.md`(FR-0-1~8) · **`dialogue-design.md`(FR-0-9~16 — `API_CONDITION` 정의·저장 · NFR-S3~S5)** · `quality-channel.md`(FR-0-17~23 — 시뮬레이션·공개 대화) · **`security-audit.md`(FR-0-24~30 — J-5 `ApiCallLog` 분리)** · `stats-learning.md`(FR-0-31~38) · **`nlu-rag-answering.md`(FR-0-39~48 — 외부 출구 봉인 선례)** · `learning-augmentation.md`(FR-0-49~58) · **`validation-regression.md`(FR-0-59~67 — TC 실행 격리)** · `version-history.md`(FR-0-68~77) · `scheduled-deploy.md`(FR-0-78~87) · `integrated-stats.md`(FR-0-88~95)
> **핵심 선행 ADR**: **ADR-0008**(미지원 아웃풋 3종 · `UNSUPPORTED_OUTPUT_TYPES` 공유 상수 50행) · **ADR-0016 §5**(`AuditLog`/`ApiCallLog` 분리 90~94행) · **ADR-0022**(외부 출구 1개 클래스 · allowlist 봉인 · 정적 검사 — 이 그룹이 따를 형식) · **ADR-0013**(PII 마스킹 1벌 함수 · 적용 지점) · ADR-0009(클라이언트 보관 대화 상태 · 서명 기각 70행) · ADR-0010(엔진 단일 진입점 `resolveTurn`) · ADR-0015(권한 15종) · ADR-0023(보류 답변 PENDING — 이 그룹은 **재사용하지 않는다**, J-5) · ADR-0026 §⑤(자격증명 = 환경변수만) · ADR-0029/0030(TC 실행 격리 · 응답 해시) · ADR-0031/0032(스냅샷 · 예약 배포)
> **작성일**: 2026-09-24 · **다음 단계**: `system-architect`(**ADR-0034** 신규) → `ui-designer` → `backend-implementer` → `frontend-implementer` → `code-reviewer` → `test-automation`
>
> ⚠ **조사 한계**: `docs/00-source/*.pdf` 렌더링이 불가능하다(`pdftoppm` 미설치 — `stats-learning.md` 56행과 같은 제약). ROCHA 원본의 "API 조건" 편집 화면 필드는 직접 인용하지 못했고, **카탈로그 원문 1줄 + 기존 스키마 + 코드 사실**만 근거로 삼았다.

---

## 1. 배경 / 목적

### 1.1 배경 — 선행 그룹이 "No.26"으로 넘긴 인계 목록

| # | 기록 위치 | 넘긴 것 | 이 문서의 판정 |
|---|---|---|---|
| T-1 | ADR-0008 50행 · `dialogue-design-설계.md` 476행 | "`UNSUPPORTED_OUTPUT_TYPES`에서 **값을 빼는 것만으로** 실행이 열린다" | ★ **본체 — 범위 안.** 단 "빼는 것만으로"는 **성립하지 않는다**(§1.2.2 — 엔진이 동기라 호출할 자리가 없고, 기존 저장 데이터는 실행하면 안 되는 형태다) |
| T-2 | `dialogue-design.md` 418행 NFR-S4 · `dialogue-design-설계.md` 477·1148행 · `dialogue.ts` 520~523행 JSDoc | "**SSRF 방어**(사설 IP 대역 차단)는 실행 Phase(No.26)의 책임" | **범위 안** — 단 "사설 대역 차단"만으로는 **구축형 사내 레거시에 접근할 수 없다**(모순). 다층 방어 + 운영자 allowlist로 재정의(J-11) |
| T-3 | `dialogue-design.md` 419행 NFR-S5 · 설계서 478행 · `messages.ts` 723행 "저장은 평문으로 되며" | "`headers`의 인증 토큰은 평문 저장 — **암호화는 No.26/No.45 과제**" | ★ **핵심 결정** — 암호화가 아니라 **노드에서 시크릿을 제거**한다(J-2·J-3) |
| T-4 | ADR-0016 §5 90~94행 · 개발명세서 174·198행 · `security-audit.md` 49·714행 J-5 | "**No.26 착수 시 `ApiCallLog`를 별도 테이블로 설계**(감사로그와 보존기간·용량·마스킹 요건이 다름)" | **범위 안** — `RagCallLog`(schema.prisma 482~507행) 형식을 따른 **메타데이터 전용** 테이블(J-13) |
| T-5 | 개발명세서 288행 "채널 자격증명은 저장하지 않는다 … **연동 착수 시점에 암호화·시크릿 관리 방식을 먼저 결정한다**" | 시크릿 관리 방식 결정 | ★ **P-3** — 권고: DB 미저장 · 환경변수 참조(`secretRef`) |
| T-6 | `dialogue-design.md` 281행 FR-5-14 ⑩ · 648행 | "`SCENARIO`(기간계 연동) … 실행은 **No.26**" | **범위 밖 권고** — `SCENARIO`는 미지원 유지, No.39(커넥터 허브)로(J-1, ⚠ P-1) |
| T-7 | `validation-regression.md` 334행 FR-V1-31 · `quality-channel.md` 139행 FR-10-10 | TC·시뮬레이터는 미지원 아웃풋을 `일부 아웃풋 미실행` 배지로 표시 | **범위 안** — 시뮬레이터·TC에서 **실제 호출 여부**를 결정해야 한다(J-15, ⚠ P-13) |
| T-8 | `dialogue-design-ui-spec.md` 197행 `UnsupportedOutputBadge` · 973행 헤더 마스킹 시각 스펙 미규정 | UI 배지·헤더 마스킹 | **범위 안** — v2 편집기에는 헤더 입력이 없다(J-2). 배지는 v1 레거시 형태에만 남는다(J-16) |

### 1.2 이미 있는 것과 없는 것 (코드 확인)

#### 1.2.1 `API_CONDITION`의 현재 저장 스키마 · UI · 실행

| 자산 | 실제 구현 (파일:행) | 이 그룹에서의 의미 |
|---|---|---|
| **저장 스키마** | `packages/shared-types/src/dialogue.ts` 511~530행 — `{ method: GET\|POST\|PUT\|PATCH\|DELETE, url: SafeUrlSchema, headers?: Record<string,string>, bodyTemplate?: string ≤4000, conditions: [{ path ≤200, operator: EQ\|NEQ\|GT\|GTE\|LT\|LTE\|CONTAINS\|EXISTS, value? ≤500, nextNodeId: uuid }] 1~10 }` | ⚠ ① **URL·헤더(토큰)가 노드 아웃풋 JSON 안에 있다** → 번들·버전 스냅샷·시뮬레이션 오버레이·노드 조회 응답에 그대로 실린다 ② **응답값 매핑 필드가 없다**("응답값 실시간 매핑·출력"을 표현할 수 없다) ③ **실패·불일치 분기가 없다** ④ `bodyTemplate`은 **자유 문자열**이라 값 치환 시 JSON 인젝션 여지가 있다 ⑤ 카탈로그는 GET/POST인데 5종을 받는다 |
| `SafeUrlSchema` | `common.ts` 155~160행 — `.url()` + `/^https?:\/\//i` refine | 스킴 제한만 있다. **호스트·IP·리다이렉트·DNS 재바인딩 검증 없음**(T-2) |
| **`UNSUPPORTED_OUTPUT_TYPES`** | `dialogue.ts` 431~432행 `['SCENARIO','SURVEY','API_CONDITION']` | 소비처: 설계 점검 `design-validator.ts` 185행(INFO). ⚠ **웹 UI 배지는 이 상수를 쓰지 않고 타입을 하드코딩**한다(`DialogOutputEditor.tsx` 126행) — "상수에서 빼면 열린다"가 UI에서는 성립하지 않는다 |
| **엔진 실행** | `dialogue-engine/src/outputs.ts` 94~99행 — `API_CONDITION`을 `unsupported`에 넣고 **다음 아웃풋으로 계속 진행**. 전부 미지원이면 `UNSUPPORTED_OUTPUT_NOTICE`(`constants.ts` 16행)로 폴백(103~106행) | 실행 순서 규약이 필요하다 — 호출 후 분기하면 **뒤따르는 아웃풋은?**(J-6) |
| **UI 편집기** | `DialogOutputEditor.tsx` 473~652행 — 메서드 select(5종) · URL 텍스트 · 헤더 key/value(값은 `type=password` + 표시 토글 491·538~547행) · 본문 textarea(564~573행) · 조건 목록(경로·연산자 8종·값·다음 노드 picker 577~648행) | 헤더 값은 **화면에서만 가려진다**. 저장·응답은 평문(`messages.ts` 723행 안내문 그대로) |
| **조회 권한** | `dialog-nodes.controller.ts` 35~36·57~58행 `dialogue:read` · `security.ts` 48행 **VIEWER가 `dialogue:read` 보유** | ⚠ **현재도 VIEWER가 노드 조회 API로 헤더 토큰을 평문으로 읽을 수 있다.** 노드 복사(`:id/copy` 73행)도 토큰을 복제한다 |
| 감사 스냅샷 | `audit-snapshot.ts` 39행 — `DialogNode` 화이트리스트에 `outputs`가 **없다**(`outputCount`만) | 토큰이 **감사로그에는 들어가지 않는다**(좋은 사실). 유지한다 |
| **노드 참조 무결성** | 저장 검증 `dialog-nodes.service.ts` 92~104행(`DIALOG_MOVE`·`BUTTON`·`CARD`만) · 삭제 409 `reference-check.service.ts` 131~157행(동일) · 흐름/고아 판정 `design-validator.ts` 5~18행 `getOutgoingNodeRefs`(동일) · 스냅샷 무결성 `snapshot-integrity.ts` 83~101행(동일) | ⚠ **`conditions[].nextNodeId`는 네 곳 모두에서 빠져 있다** — 존재하지 않는 노드로 저장 가능 · 참조 중인 노드 삭제 가능 · 들어오는 참조 수 0으로 집계(고아 오판). 실행이 없어서 드러나지 않던 **잠재 결함**이다(J-17) |
| 시드 데이터 | `prisma/seed.ts` 497~498행 — 미지원 배지 검증용으로 **`SURVEY`만** 넣었다 | 개발 DB에 v1 `API_CONDITION` 행은 시드로 생기지 않는다. 실제 잔존 건수는 착수 시 계측(FR-L9-4) |

#### 1.2.2 엔진·대화 경로 — "상수에서 빼면 열린다"가 성립하지 않는 이유

| 사실 (파일:행) | 결과 |
|---|---|
| `resolveResponse()`는 "**DB·NestJS 무의존 순수 함수이며 예외를 던지지 않는다**"(`resolver.ts` 115~126행). `executeOutputs()`도 동기 함수다(`outputs.ts` 28~33행) | 엔진 안에서 `await fetch`를 할 수 없다. 엔진을 async로 바꾸면 **소비자 4곳**(공개 대화 `public-conversation.service.ts` 134행 · 시뮬레이션 `simulation.service.ts` 74행 · 비교 189~191행 · TC 실행 `test-run.executor.ts` 408행)이 전부 바뀐다 |
| 엔진 밖 사전 계산 선례 = **의미 유사도 점수 주입**(ADR-0020, `public-conversation.service.ts` 122~134행) | 점수는 "입력 문장"만 있으면 미리 계산된다. API 호출은 **어느 노드가 매칭될지 알아야** 하므로 사전 계산이 불가능하다 → **정지점(suspension) 방식**이 필요(J-4) |
| 엔진 밖 비동기 선례 = **외부 RAG PENDING**(ADR-0023, 146~161·227~281행) | RAG는 **다음 대화 상태(`nextState`)가 PENDING 시점에 이미 확정**된다(276~277행). API 분기는 **호출 결과에 따라 다음 노드가 달라지고 그 노드가 폼을 시작할 수도 있어** 상태를 미리 확정할 수 없다 → PENDING 재사용 부적합(J-5) |
| 템플릿 치환 문법 = **컨텍스트 완료 메시지 `{슬롯명}`만** 존재(`context-session.ts` 135~138행, 정규식 `/\{([^{}]+)\}/g`, 없는 키 → 빈 문자열). `TEXT`·`CARD` 등 일반 아웃풋은 **치환하지 않는다** | 일반 텍스트에 치환을 켜면 기존에 `{...}`를 문자 그대로 쓰던 답변이 **깨진다**(회귀). 치환은 **API 연속 실행 구간의 `{api.이름}` 토큰에만** 적용한다(J-10) |
| 완료된 폼 값은 **그 턴에만** 존재 — 완료 시 `nextSessionOverride = null`(`resolver.ts` 201~204행), 다음 턴 상태에 남지 않는다. 대화 상태는 **클라이언트 보관 봉투**다(ADR-0009 1행, 서명 기각 70행) | ① 요청 파라미터의 원천은 **같은 턴에 완료된 폼 슬롯**뿐이다(J-8) ② API 응답값을 다음 턴까지 들고 가려면 **클라이언트 상태에 넣어야** 하는데, 그러면 사용자에게 노출되고 **조작 가능**해진다 → 보존하지 않는다(J-9) |
| 출구 금지어 필터 `maskOutbound()`는 엔진 결과 렌더링 **이후** 항상 적용(`public-conversation.service.ts` 136~138행) | API 응답값이 치환된 출력도 **자동으로 출구 필터를 통과**한다(추가 지점 불필요, FR-L6-9) |
| 위젯 텍스트 렌더러는 `textContent`만 사용(`apps/widget/src/ui/renderers/text.ts` 1~6행 "innerHTML 0건") | 외부 응답값을 텍스트에 넣어도 **HTML 주입이 구조적으로 불가능**하다. 단 URL 필드 치환은 별개 위험(피싱 링크) → 금지(J-10) |

#### 1.2.3 외부 호출 인프라 선례

| 자산 (파일:행) | 이 그룹에서의 취급 |
|---|---|
| **`RagHttpClient`** — "외부 RAG 서버로 나가는 **유일한 출구**", 경로를 인자로 받지 않음(`rag-http.client.ts` 26~31·64~65행), 정적 검사 `rag-allowlist.spec.ts`(ADR-0022 §3) | ★ **형식을 그대로 따른다**: `LegacyApiHttpClient` 1개 클래스 = 레거시 호출의 유일한 출구, 정적 검사로 단언(FR-0-99). 단 **레거시는 호출 대상이 관리자 설정이므로** "경로 상수 allowlist"가 아니라 "**등록된 연결 + 네트워크 계층 검증**"으로 봉인한다 |
| `RagHttpClient.send()` — `fetch` 기본값 사용(72행) · `res.text()`로 **전체 본문 수신**(79행) | ⚠ 선례에는 **리다이렉트 제어·응답 크기 상한이 없다.** RAG는 고정 서버라 허용 가능했지만, 레거시는 관리자가 입력한 임의 호스트라 **반드시 필요**하다(J-11). RAG 쪽 보강은 범위 밖(§9, 제안만) |
| `RagGateService` — 회로차단(`RAG_CIRCUIT_FAILURE_THRESHOLD` 5 · `OPEN_MS` 60000) · 동시성 · 분당 레이트리밋(`env.validation.ts` 58~61행) | **연결 단위**로 같은 패턴을 둔다(FR-L5-8). 인스턴스 로컬 카운터이며 교체 지점 1곳(개발명세서 299행 확장성 규약) |
| `RagCallLog` — 원문 미저장 · FK 없음 · `outcome`/`httpStatus`/`latencyMs`/`retryCount`/`dayBucket`(schema.prisma 482~507행) | ★ **`ApiCallLog`의 원형**(J-13) |
| 외부 HTTP 출구 현황 — RAG(`rag-http.client.ts`) · 임베딩(`http-embedding.provider.ts`) · 증강(`gemini-/local-augmentation.provider.ts`) | 레거시가 **4번째 출구 계열**이 된다. 개발명세서의 "출구 3곳" 문구 갱신 필요(§10) |
| 자격증명 = **환경변수로만 주입, 코드·DB 미저장**(개발명세서 291행 ⑤ · `AUGMENTATION_GEMINI_API_KEY` `env.validation.ts` 67행) · 채널 config에 자격증명 필드 없음(schema.prisma 259행) | ★ **시크릿 저장 권고안의 근거**(J-3) |
| **`maskPii()`** 1벌 함수(`packages/pii-mask/src/index.ts` 66행). 적용 지점 3곳 = 저장 · RAG 송신 · 증강 송신(개발명세서 291·293행). 시뮬레이터 RAG 호출도 마스킹(`simulation.service.ts` 134행) | 레거시 송신이 **4번째 적용 지점 후보**. 단 레거시 조회는 **식별자(전화번호·계좌)를 보내야 동작**하는 경우가 많다 — 마스킹하면 기능이 무의미해진다(J-12, ⚠ P-10) |
| 시뮬레이션 권한 `simulation:read`(`simulation.controller.ts` 21·31행) — **VIEWER 보유** · 요청에 **미저장 노드 오버레이** 허용(`conversation.ts` 50~51행 `DialogueOverlaySchema.dialogNodes`) | ⚠ 시뮬레이터가 실제 호출을 하면 **VIEWER가 오버레이로 만든 임의 `API_CONDITION`으로 외부(또는 사내망)에 POST**할 수 있다 → 실제 호출은 제한적 opt-in(J-15) |

**없다**: 등록된 연결(호스트) 개념 · 시크릿 참조 · SSRF 네트워크 검증 · 응답 경로 추출기 · 응답값 매핑 · 실패/불일치 분기 · 엔진 정지점/재진입 · 호출 로그 · 실행 결과 시뮬레이션 표시 · 노드 참조 무결성의 `API_CONDITION` 편입.

### 1.3 ★ 선결 쟁점 — "외부 호출을 대화 파이프라인의 어디서 하는가"

#### 1.3.1 후보 비교

| 후보 | 구조 | 순수성·동기성 | 소비자 영향 | 판정 |
|---|---|---|---|---|
| **(A) 정지점 + 엔진 밖 실행 + 엔진 재진입** ★ | 엔진이 `API_CONDITION`을 만나면 **실행을 멈추고 "호출 요청서"(연결 id·경로·바인딩된 값·재개 위치)** 를 결과에 담아 반환 → API 계층이 호출 → 엔진의 **순수 함수**로 응답 추출·조건 판정 → `resumeAfterApiCall()`로 **분기 노드부터 재진입** | **유지** — 엔진은 여전히 I/O 0건·동기·예외 없음. 경로 추출·조건 판정·치환도 엔진 내 순수 함수 | 공개 대화: 실제 호출 / 시뮬레이터: 목 또는 opt-in 실제 / 비교·TC: 항상 목. **정지 결과를 무시하는 소비자는 기존과 같은 결과**(아래 폴백)를 얻어 회귀 위험이 낮다 | **채택 권고** |
| (B) 비동기 엔진 + 호출 포트 주입 | `executeOutputs`를 async로, `fetcher` 포트 주입 | **깨짐** — ADR-0008/0010의 "순수 함수" 전제 붕괴, 엔진 단위 테스트 전체가 async 전환 | 4 소비자 + 엔진 테스트 전부 수정. TC 대량 실행(500 TC/분 예산)에 await 체인 삽입 | 기각 |
| (C) 사전 호출 | 엔진을 한 번 돌려 매칭 노드를 알아낸 뒤 호출하고 **다시 처음부터** 돌림 | 유지 | 턴당 엔진 2회 · 첫 실행과 두 번째 실행의 세션 전이가 어긋날 수 있음(폼 완료 턴) | 기각 |
| (D) PENDING 재사용(ADR-0023) | 1차 응답 "조회 중…" + 폴링 | 유지 | **분기 후 상태를 PENDING 시점에 확정할 수 없다**(§1.2.2). `PendingAnswerStore`는 RAG 전용 스냅샷 | 기각(재검토 트리거: 레거시 응답이 상시 5초 초과) |

#### 1.3.2 (A)의 대가 — 이 그룹은 **엔진을 수정한다**

선행 그룹 6곳이 "`packages/dialogue-engine`을 수정하지 않는다"를 FR-0에 넣었다(FR-0-49·68·78·88 등). 이 그룹은 **그 규약의 의도된 예외**다. 다만 수정 범위를 FR-0-96으로 **닫힌 목록**으로 고정하고, 엔진에 I/O 심볼이 0건임을 정적 검사로 유지한다.

### 1.4 목적

1. 관리자가 대화 노드에 **"외부 시스템에 물어보고 그 답으로 분기·출력"** 을 설정할 수 있고, 최종 사용자는 한 턴 안에 결과를 받는다(카탈로그 "실시간 매핑·출력").
2. **시크릿이 노드·번들·스냅샷·브라우저 어디에도 존재하지 않는다.**
3. 관리자 입력이 호출 대상을 정하더라도 **서버가 사내망·자기 자신·클라우드 메타데이터를 공격하는 발판이 되지 않는다**(SSRF).
4. 외부 시스템이 느리거나 죽어도 **대화는 정해진 시간 안에 정해진 문구로 끝난다**. 외부 장애가 우리 서버 장애로 번지지 않는다(회로차단).
5. 외부 호출은 **누가 · 언제 · 어느 연결로 · 결과가 무엇이었는지** 추적 가능하되, **요청·응답 원문은 저장하지 않는다**.
6. 엔진은 **순수·동기**를 유지하고, 기존 대화·시뮬레이션·TC·버전·예약 배포의 동작이 **API 노드가 없는 챗봇에서 바이트 단위로 동일**하다.

### 1.5 이 문서의 핵심 판단 20건 (⚠ = PM 확인 필요)

> **PM 결정: 권고안 채택(2026-09-24)** — ⚠ 표시 항목(J-1·J-2·J-3·J-5·J-6·J-7·J-9·J-11·J-12·J-13·J-14·J-15·J-16)을 포함해 아래 "결정(제안)" 열이 전부 확정되었다(§11 P-1~P-15). J-4(엔진 정지점/재진입)·J-17(참조 무결성 편입)·J-18(스냅샷 취급)은 architect 확정 사항이다. 세부 설계: `docs/02-spec/legacy-api-integration-설계.md` · ADR-0034.

| # | 쟁점 | 결정(제안) | 근거 요약 |
|---|---|---|---|
| **J-1** | ⚠ **범위: `SCENARIO`도 실행하는가** | **`API_CONDITION`만 실행.** `SCENARIO`(`{scenarioKey, params}`)는 미지원 유지 → `UNSUPPORTED_OUTPUT_TYPES = ['SCENARIO','SURVEY']` | 카탈로그 No.26 문구는 "대화상자 **조건**에 외부 API 연결"이다. `SCENARIO`의 `scenarioKey`는 "사전 정의된 기간계 거래"를 가리키는데 그 정의 저장소·계약이 없다 — 이는 **No.39(표준 커넥터 허브)** 의 몫이다. 이 그룹의 연결 레지스트리가 그 토대가 된다(§4.10) |
| **J-2** | ⚠ **연결 레지스트리 도입** | 노드는 URL·헤더를 갖지 않는다. 관리자가 **전역 `ApiConnection`**(이름·기준 URL·인증 방식·시크릿 참조·허용 메서드·타임아웃·사용 여부)을 등록하고, 노드는 **`connectionId` + 상대 경로**만 저장한다 | 노드 JSON은 번들 캐시·버전 스냅샷(ADR-0031)·시뮬레이션 오버레이·노드 조회 응답(VIEWER 포함)·노드 복사로 **복제·유출되는 자산**이다(§1.2.1). 호출 가능한 호스트를 **ADMIN이 명시적으로 등록한 것**으로 좁히는 것 자체가 SSRF 1차 방어선이다 |
| **J-3** | ⚠ **시크릿 저장 방식**(T-5) | **DB에 저장하지 않는다.** 연결은 `secretRef`(이름)만 갖고 실제 값은 환경변수 `LEGACY_API_SECRET__<REF>`에서 읽는다. 콘솔은 "설정됨/미설정" 상태만 표시 | 기존 선례 2건과 일치(채널 자격증명 미저장 · 증강 API 키 = 환경변수만, 개발명세서 288·291행). **암호화 키 관리·회전·백업 유출**이라는 새 문제를 들이지 않는다. 대가: 시크릿 추가·교체에 **운영자(서버 설정) 작업**이 필요 — 구축형에서는 자연스럽고, 구독형 셀프서비스에는 불편(재검토 트리거 = No.45 필드 암호화) |
| **J-4** | **엔진 통합 방식**(선결 쟁점) | **(A) 정지점 → 엔진 밖 실행 → 순수 재진입**(§1.3). 엔진 수정은 FR-0-96의 닫힌 목록으로 한정 | §1.3.1 |
| **J-5** | ⚠ **동기/비동기 · 성능 예산** | **동기**(같은 HTTP 응답 안에서 완결). 연결별 타임아웃 **기본 3초 · 허용 1~10초**. 턴당 외부 호출 **최대 1회**. PENDING 미사용 | 분기 후 상태 확정 문제(§1.2.2). 공개 대화 500ms 예산은 **API 노드가 없는 턴에서 불변**이고, API 턴은 "기존 예산 + 외부 응답시간(상한 = 타임아웃)"으로 **별도 예산**을 둔다. "턴당 RAG 1회" 선례(개발명세서 282행)와 같은 N+1 금지 |
| **J-6** | ⚠ **실행 순서 · 실패/불일치 분기** | `API_CONDITION`은 노드 아웃풋 목록의 **종결자**다 — 앞의 아웃풋은 출력하고, **뒤의 아웃풋은 실행하지 않는다**(설계 점검 WARNING). 조건은 **위에서부터 첫 일치** → `nextNodeId`. 불일치 → 선택 `defaultNodeId`. 호출 실패 → 선택 `failureNodeId`. 지정이 없으면 **고정 안내 문구** | `CONTEXT_FORM`이 이미 "세션 시작 후 남은 아웃풋을 버린다"는 종결 규약을 갖는다(`outputs.ts` 24~26·75행). "불일치"와 "실패"는 관리자가 다르게 안내하고 싶어 한다(예: "주문 내역이 없어요" vs "지금은 조회할 수 없어요") |
| **J-7** | ⚠ **메서드** | **GET · POST만.** PUT/PATCH/DELETE는 새로 저장할 수 없다(기존 v1 값은 읽기 호환만) | 카탈로그 "외부 API(GET/POST)". 익명 공개 채팅에서 **원격 수정·삭제를 트리거**하는 것은 조회보다 위험 등급이 다르다. POST도 **재시도하지 않는다**(비멱등) |
| **J-8** | **요청 구성** | 자유 문자열 템플릿(`bodyTemplate`) 폐기 → **구조적 바인딩**: 경로 세그먼트·쿼리·본문 필드 각각에 `{ 상수 }` 또는 `{ 같은 턴에 완료된 폼의 슬롯 }`을 연결. 값은 경로·쿼리에선 **퍼센트 인코딩**, 본문은 **객체로 구성 후 `JSON.stringify`** | 문자열 이어붙이기는 사용자 입력(슬롯 값)이 `"`·`}`·`../`·`?`를 넣어 **요청 구조를 바꾸는** 인젝션 경로다. 원천을 "같은 턴 완료 폼"으로 한정하는 것은 엔진 사실(§1.2.2)과 일치 |
| **J-9** | ⚠ **응답값의 수명** | **같은 턴 안에서만** 쓴다(분기 판정 + 분기 노드 출력 치환). **다음 턴 대화 상태·`ContextVariable`에 저장하지 않는다** | 대화 상태는 클라이언트 보관·무서명이다(ADR-0009). 응답값을 넣으면 ① 위젯 요청 본문에 **외부 시스템 데이터가 평문 왕복** ② 사용자가 **"인증됨=true" 같은 값을 조작**해 다음 분기를 속일 수 있다. `ContextVariable`은 슬롯 필링 폼 **정의**이지 변수 저장소가 아니다 |
| **J-10** | **출력 치환 문법** | 기존 `{이름}` 문법을 재사용하되 **`{api.이름}` 네임스페이스 토큰만** 치환. 대상 필드는 **텍스트 필드만**(`TEXT.text` · `CARD.title/description` · `BUTTON.text`/버튼 `label`). **URL 필드(`LINK.url`·`IMAGE.imageUrl`·`CARD.imageUrl`·버튼 LINK 값) 치환 금지**. 값은 제어문자 제거 · 매핑별 길이 상한(기본 200자) | 일반 텍스트 전체 치환은 기존 답변 회귀(§1.2.2). 외부가 준 URL을 링크로 내보내면 **피싱·오픈 리다이렉트** 경로가 된다. 위젯은 `textContent`라 HTML 주입은 이미 막혀 있다 |
| **J-11** | ⚠ **SSRF 방어**(T-2) | **다층**: ① 등록된 연결만(J-2) ② 스킴 `http`/`https`(기존 refine) ③ **DNS 해석 후 실제 접속 IP를 검사**(재바인딩 방지) ④ **절대 차단**: 루프백(`127/8`·`::1`)·링크로컬(`169.254/16`·`fe80::/10`)·메타데이터(`169.254.169.254`·`fd00:ec2::254`)·`0.0.0.0/8`·IPv4 매핑 IPv6 ⑤ **사설·내부 대역**(`10/8`·`172.16/12`·`192.168/16`·`100.64/10`·`fc00::/7`)은 **운영자 환경변수 allowlist에 있을 때만** ⑥ **리다이렉트 따라가지 않음**(3xx = 실패) ⑦ **응답 크기 상한 256KB**(스트림 중단) ⑧ **JSON 응답만** | NFR-S4의 "사설 대역 차단"만으로는 **구축형 사내 레거시(10.x)에 접근할 수 없다** — 기능의 존재 이유와 충돌한다. 그래서 사설 대역은 **네트워크 운영자**가 열고(환경변수), 루프백·메타데이터는 **누구도 열 수 없다**. 루프백 차단이 특히 중요하다 — **ml-worker·임베딩 서버가 로컬에 떠 있다**(ADR-0024) |
| **J-12** | ⚠ **PII 외부 송신** | **기본 = 송신 값 PII 마스킹**(`maskPii` 1벌 재사용 — 적용 지점 4번째). 연결 단위 **`allowRawPersonalData`**(ADMIN만 설정, 기본 false)가 켜진 연결에 한해 원문 송신. **로그·트레이스에는 항상 원문 미저장** | 전화번호·주문번호로 조회하는 것이 레거시 연동의 대표 용례라 **무조건 마스킹이면 기능이 무의미**하다. 반대로 무조건 원문이면 ADR-0013의 "외부 송신 전 마스킹" 원칙이 조용히 깨진다. **연결(=신뢰 경계) 단위 명시적 승인**이 원칙과 기능의 절충점이다 |
| **J-13** | ⚠ **`ApiCallLog`**(T-4) | **메타데이터 전용**: 연결 id · 챗봇 · 노드 · 대화로그 id · 출처(공개/시뮬레이터 실호출) · 메서드 · **경로 템플릿**(치환 전) · 결과 코드 · HTTP 상태 · 지연 · 응답 바이트 · 선택된 분기 · KST 일 버킷. **URL 치환값·헤더·요청/응답 본문 저장 0**. 자동 보존 정리 **1차 없음** | `RagCallLog` 선례(원문 미저장). ADR-0016 §5가 우려한 "Header에 토큰/PII 포함"을 **아예 담지 않는 것**으로 해소한다. 행이 작아(수백 바이트) 정리 배치 없이도 1차 운영 가능. 보존기간은 No.45(RagCallLog·ConversationLog와 함께) |
| **J-14** | ⚠ **권한** | **신규 권한 0종.** 연결 CRUD·연결 테스트 = **`security:write`**(ADMIN) · 연결 상세 조회 = `security:read` · 노드 편집기의 **연결 선택 목록**(이름·허용 메서드·사용 여부만) = `dialogue:read` · 노드 저장 = `dialogue:write`(기존) · 호출 로그 조회 = `chatbot:read` | "어디로 나갈 수 있는가"는 **외부 송신 경계**라 금지어·로그인 정책과 같은 보안 설정 도메인이다. EDITOR는 **등록된 연결을 쓰기만** 한다 |
| **J-15** | ⚠ **시뮬레이션(No.10) · TC(No.19)** | **기본 = 목(mock).** 연결별로 관리자가 등록한 **샘플 응답**(또는 시뮬레이터에서 직접 입력한 JSON)으로 분기·치환을 재현. **실제 호출은 시뮬레이터 단건에서만 opt-in**(`liveApi: true`) — 조건: `simulation:write` 보유 · **GET만** · **오버레이가 아닌 저장된 노드**만. 비교(compare)·TC 대량 실행은 **항상 목** | TC 실행 격리 원칙(ADR-0030 — 운영 자원·로그를 건드리지 않는다)과 결정론(응답 해시 비교). 시뮬레이터는 `simulation:read`(VIEWER)로 열려 있고 오버레이를 받으므로 무조건 실제 호출이면 **VIEWER발 SSRF·원격 POST**가 된다(§1.2.3) |
| **J-16** | ⚠ **기존 저장 데이터 호환**(v1) | **읽기 스키마 = v1(인라인 url/headers) ∪ v2(연결 참조)**, **쓰기 스키마 = v2만**. v1은 **실행하지 않는다**(기존처럼 `unsupportedOutputs` + 배지 + 설계 점검 WARNING "연결로 전환 필요"). 자동 변환·자동 삭제(스크럽) 없음. 스냅샷 업캐스터 불필요 | 자동 변환은 url을 보고 **연결을 임의 생성** = ADMIN 승인 없는 송신 경계 확장. 자동 스크럽은 `DialogNode` 쓰기 경로를 늘려 **자산 쓰기 봉인**(ADR-0025 S-1 허용 파일 3개)을 깨고 스냅샷 해시를 흔든다. 읽기 호환이면 과거 스냅샷 복원도 그대로 된다(`UPCASTERS`가 빈 맵 — `snapshot-upcasters.ts` 9행) |
| **J-17** | **노드 참조 무결성 편입** | `conditions[].nextNodeId` · `defaultNodeId` · `failureNodeId`를 **저장 검증 · 삭제 409 · `getOutgoingNodeRefs`(들어오는 참조·고아·흐름) · 스냅샷 무결성 경고** 네 곳에 편입. **v1 데이터에도 적용**(읽기 전용 경고) | §1.2.1 잠재 결함. 실행이 열리면 끊긴 참조가 **런타임 폴백**으로 드러난다 |
| **J-18** | **No.25 버전 · No.28 예약 배포** | 연결(`ApiConnection`)은 **스냅샷 대상이 아니다**(전역 설정 — 금지어·채널과 같은 취급). 노드의 `connectionId` 참조는 스냅샷에 포함. 복원 후 연결이 없거나 꺼져 있으면 **경고(차단 아님)**, 실행 시 실패 분기. 예약 배포는 변경 없음 | 스냅샷에 시크릿이 들어갈 자리가 **원천적으로 없다**(J-2·J-3). 참조 끊김 = 경고는 ADR-0031 EX-H-5 "캡처 당시 상태 재현이 복원의 정의" 규약 |
| **J-19** | **최종 사용자 익명성** | 위젯 사용자는 **인증되지 않는다**. "전화번호로 주문 조회" 같은 **개인정보 조회형 연동**은 제3자 정보 열람 위험이 있다 → 연결에 **`personalDataLookup` 표시 + 편집기 경고 + 연결 단위 레이트리밋**. 최종 사용자 인증은 범위 밖 | 기능이 이 위험을 **새로 만든다**. 막을 수는 없고(레거시 설계 문제) **보이게** 해야 한다. 레거시 쪽에 "주문번호+전화번호" 같은 2요소 대조를 권고하는 안내 |
| **J-20** | **GPU 필요도 · 배포 형태** | **GPU 1 유지.** 구축형 ○ · 구독형 ○(전제조건) | §4.11 · §4.12 |

### 1.6 원본 근거 인용

**근거 1 — 카탈로그 No.26 원문**(`기능요구사항.md` 63행):
> "레거시 API 연동 | **대화상자 조건에 외부 API(GET/POST) 연결, 응답값 실시간 매핑·출력** | GPU 1 | 사유: **API 호출·파싱(경량)** | 구축형 ○ 구독형 ○"

→ 요구는 **네 개**다: ① "대화상자 조건에"(노드 아웃풋 안의 분기 — 기존 `API_CONDITION` 자리, J-6) ② "GET/POST"(J-7) ③ "응답값 매핑"(경로 추출 — J-9/J-10) ④ "실시간 출력"(같은 턴 동기 — J-5). GPU 사유 "호출·파싱"은 새 추론이 없다는 뜻이다(J-20).

**근거 2 — ADR-0008 50행**:
> "`UNSUPPORTED_OUTPUT_TYPES` … 상수를 `shared-types`에 두고 **엔진·API·UI 배지가 공유**한다. … No.26/27 구현 시 **이 상수에서 값을 빼는 것만으로** 실행이 열린다."

→ 방향은 유지하되, 실제로는 ① 엔진에 호출 자리가 없고 ② UI 배지가 상수를 쓰지 않으며 ③ v1 데이터는 실행하면 안 되므로 **"타입이 아니라 payload 형태로 실행 가능 여부 판정"** 이 필요하다(FR-L1-3).

**근거 3 — ADR-0016 §5 92~94행**:
> "No.26(레거시 API 연동)이 미구현이고 … **쓰기 주체 없는 스키마 금지**. … 감사로그는 '누가 무엇을 바꿨나'(저용량·장기보존·요약·불변), API 로그는 '외부 호출 원문'(고용량·단기보존·**Header에 토큰/PII 포함 가능**)이다."

→ 이 그룹이 쓰기 주체를 만든다. 다만 "외부 호출 원문"을 **저장하지 않는 쪽**으로 설계해 고용량·마스킹 문제를 원천 제거한다(J-13).

**근거 4 — 개발명세서 288행**:
> "**채널 자격증명은 저장하지 않는다** — config 스키마에 해당 필드를 두지 않으며, **연동 착수 시점에 암호화·시크릿 관리 방식을 먼저 결정한다**."

→ J-3(P-3).

**근거 5 — `dialogue-design.md` 418~419행 NFR-S4/S5**: "`API_CONDITION`의 `url`은 … **SSRF 위험** … 실행 Phase(No.26)에서 사설 IP 대역 … 차단이 필요" · "`headers`에 담기는 인증 토큰은 평문 저장 … **암호화 저장은 No.26/No.45 과제**" → J-11 · J-2/J-3.

### 1.7 전체 흐름 (이 문서가 만드는 것)

```
■ 준비 (ADMIN, 보안 설정 > API 연결)
  연결 등록 { 이름, 기준 URL(https://erp.corp.local/api), 허용 메서드[GET,POST], 인증(NONE|API_KEY_HEADER|BEARER|BASIC),
             secretRef("ERP") ← 값은 서버 환경변수 LEGACY_API_SECRET__ERP, 타임아웃 3000ms, allowRawPersonalData=false,
             personalDataLookup, 샘플 응답(JSON, 목 전용), 사용 여부 }
  [연결 테스트] → LegacyApiHttpClient(SSRF 검사 동일 적용) → 상태·지연·응답 형식만 표시

■ 설계 (EDITOR, 대화 노드 편집)
  노드 "주문조회_실행"(조건: 컨텍스트 '주문조회폼' 완료)
    outputs: [ TEXT "조회해 볼게요.",
               API_CONDITION v2 { connectionId, method: GET, path: "/orders/{0}",
                                  pathParams:[SLOT(주문조회폼.주문번호)], query:[{name:"phone", SLOT(주문조회폼.전화)}],
                                  responseMappings:[{name:"status", path:"data.status", required:true},
                                                    {name:"eta", path:"data.delivery.eta", maxLength:20}],
                                  conditions:[{path:"data.status", EQ, "SHIPPED", nextNodeId: 배송중안내},
                                              {path:"data.status", EQ, "READY", nextNodeId: 준비중안내}],
                                  defaultNodeId: 상태미상안내, failureNodeId: 조회실패안내 } ]
  배송중안내.outputs: [ TEXT "주문하신 상품은 배송 중이며 {api.eta} 도착 예정입니다." ]

■ 대화 1턴 (공개 위젯 → apps/api)
  입구 금지어 필터 → [③④ 의미 점수 주입] → resolveTurn()  ── 순수·동기
      └ 폼 완료 → 노드 매칭 → executeOutputs: TEXT 출력 → API_CONDITION 만남 → ★ 정지
         result.apiCall = { connectionId, method, pathTemplate, 바인딩 값(원문), 재개 위치, carry 출력, hops }
  API 계층(LegacyApiService)
      연결 조회(사용 여부) → 회로·레이트 확인 → 송신 값 PII 처리(J-12) → URL 조립(퍼센트 인코딩)
      → LegacyApiHttpClient: DNS 해석 → IP 검사 → 요청(타임아웃·리다이렉트 불허·256KB·JSON)
      → 엔진 순수 함수: extractPath / evaluateConditions / buildApiVariables
  resumeAfterApiCall(요청서, {outcome, 추출값}, bundle, now)  ── 순수·동기
      → 분기 노드 outputs 실행({api.*} 치환, hop 계산 이어감) → nextState 확정
  출구 금지어 필터(maskOutbound) → 응답 반환
  fire-and-forget: ConversationLog.record()(botResponse는 기존대로 PII 마스킹) · ApiCallLog.record()(메타데이터만)
```

---

## 2. 사용자 역할 및 시나리오

### 2.1 역할

`security-audit.md` §2.1의 역할 3종 상속. **신규 권한 문자열 0종**(J-14, `Permission` 15종 불변 — `security.ts` 26~42행).

| 역할 | 이 그룹에서의 활동 | 권한(권고안) |
|---|---|---|
| **ADMIN** | API 연결 등록·수정·사용 중지·삭제 · 연결 테스트 · 원문 송신 허용 설정 · 샘플 응답 등록 | `security:read`/`security:write` |
| **EDITOR** | 노드에 API 조건 설정(등록된 연결 선택) · 시뮬레이터 목/실제(GET) 확인 · 호출 로그 조회 | `dialogue:read`/`dialogue:write` · `simulation:write`(실제 호출 opt-in) · `chatbot:read` |
| **VIEWER** | 노드 조회(연결 **이름**만 보임 — URL·시크릿 없음) · 시뮬레이터 **목 실행만** · 호출 로그 조회 | `dialogue:read` · `simulation:read` · `chatbot:read` |
| 운영자(서버) | 시크릿 환경변수 · 사설 대역 allowlist · 기능 스위치 설정 | 서버 설정(콘솔 밖) |
| 최종 사용자 | 폼에 주문번호·전화번호를 입력하고 **같은 턴에** 조회 결과를 받는다. 외부 장애 시 정해진 안내를 받는다 | — |

### 2.2 사용자 시나리오

**S-1. 주문 배송 조회 (최종 사용자 · ★ 핵심)**
사용자가 "배송 조회"를 입력 → 폼이 주문번호와 전화번호를 묻는다 → 두 번째 답을 보내는 턴에 폼이 완료되고 `주문조회_실행` 노드가 매칭된다 → "조회해 볼게요." 다음 줄에 **"주문하신 상품은 배송 중이며 09/26 도착 예정입니다."** 가 한 응답으로 온다(약 0.8초). 사용자는 "조회 중" 대기 화면을 따로 보지 않는다.

**S-2. 외부 시스템 장애 (최종 사용자 · J-6)**
ERP가 응답하지 않는다. 3초 뒤 `조회실패안내` 노드의 **"지금은 주문 정보를 확인할 수 없어요. 잠시 후 다시 시도하거나 상담원 연결을 눌러 주세요."** + 버튼이 나온다. 5회 연속 실패로 회로가 열린 뒤 60초간은 **호출 없이 즉시** 같은 안내가 나온다. `failureNodeId`가 없었다면 고정 문구 "지금은 요청하신 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요."가 나온다.

**S-3. 조건 불일치 (최종 사용자)**
응답 `data.status`가 `"RETURNED"`라 어떤 조건에도 맞지 않는다 → `상태미상안내`("주문 상태를 확인했지만 자세한 안내가 필요해요. 상담원을 연결해 드릴까요?"). 지정이 없으면 고정 문구 "확인한 결과에 맞는 안내를 찾지 못했어요. 다른 방법으로 문의해 주세요."

**S-4. 연결 등록 (ADMIN)**
보안 설정 > API 연결 > `연결 추가`. 이름 `ERP 주문`, 기준 URL `https://erp.corp.local/api`, 인증 `Bearer`, 시크릿 참조 `ERP` → 화면에 **"서버에 `LEGACY_API_SECRET__ERP`가 설정되지 않았습니다 — 운영자에게 요청하세요"** 가 뜬다. 운영자가 설정 후 재기동하자 `설정됨`으로 바뀐다. `연결 테스트`는 **"사설 주소(10.20.1.5)는 서버 허용 목록에 없어 호출할 수 없습니다"** 로 실패한다 → 운영자가 `LEGACY_API_PRIVATE_ALLOWLIST=10.20.0.0/16` 설정 → 테스트 성공(200 · 142ms · JSON).

**S-5. 노드 설계 (EDITOR)**
노드 편집 > 아웃풋 추가 > `API 조건분기` → 연결 `ERP 주문` 선택(URL·시크릿은 보이지 않고 "GET·POST 허용 · 사용 중"만) → 메서드 GET → 경로 `/orders/{0}` + 경로 값 1 = `폼: 주문조회폼 › 주문번호` → 쿼리 `phone` = `폼 › 전화` → 응답 매핑 `status ← data.status(필수)`, `eta ← data.delivery.eta(최대 20자)` → 조건 2개 → 기본/실패 분기 노드 선택 → 저장. 설계 점검은 "이 연결은 개인정보 조회형으로 표시되어 있습니다 — 익명 사용자가 다른 사람의 정보를 조회할 수 없도록 레거시 쪽 2요소 대조를 확인하세요"(INFO)를 보여 준다.

**S-6. 시뮬레이터 (EDITOR/VIEWER · J-15)**
VIEWER가 시뮬레이터에서 S-1 대화를 재현하면 **목**(연결의 샘플 응답)으로 `배송중안내`가 나오고, 결과 패널에 `외부 API: 목 응답 사용 · 분기: 조건 1 · 변수 status=SHIPPED, eta=09/26`이 보인다. EDITOR는 `실제 호출`을 켜고 다시 실행 → 실제 ERP 조회 결과(지연 212ms)가 나온다. POST 연결이면 `실제 호출`이 **비활성**이고 "POST는 시뮬레이터에서 실제로 호출하지 않습니다(목으로만 확인)"라는 안내가 붙는다.

**S-7. 기존 v1 데이터 (EDITOR · J-16)**
No.5 시절 저장한 `API_CONDITION`(URL·헤더 직접 입력)이 있는 노드를 열면 **"이전 형식입니다 — 실행되지 않습니다. 연결을 선택해 전환하세요"** 배지와 `전환` 버튼이 보인다. 헤더 값은 표시되지 않고 "이전 형식에 저장된 헤더 2개(값은 표시하지 않음) — 전환 시 삭제됩니다"만 보인다. 전환하지 않고 다른 필드만 저장하려 하면 `400`("API 조건을 연결 방식으로 전환해야 저장할 수 있습니다").

**S-8. 운영 모니터링 (EDITOR)**
챗봇 상세 > `외부 연동 로그` 탭: 오늘 1,284회 · 성공 97.1% · 시간초과 21 · 회로 열림 12 · P95 640ms. 행: `10:02:13 · ERP 주문 · GET /orders/{0} · 200 · 212ms · 조건1`. **주문번호·전화번호·응답 내용은 어디에도 없다.**

**S-9. 버전 복원 (EDITOR · J-18)**
연결 `ERP 주문`을 ADMIN이 삭제한 뒤 과거 버전 v12를 복원 미리보기 → 경고 **"대상 버전의 노드 2개가 존재하지 않는 API 연결을 참조합니다(실행 시 실패 분기로 처리)"**. 복원은 진행된다.

**S-10. 접근성 (EDITOR)**
응답 매핑·조건 목록은 위/아래 버튼으로 순서를 바꾸고(드래그 단독 금지), 연결 상태 배지는 `사용 중`/`사용 중지`/`시크릿 미설정` **텍스트를 병기**한다. 연결 테스트 결과는 `aria-live="polite"`로 읽힌다.

---

## 3. 공통 기능 요구사항 (FR-0)

선행 11개 그룹의 FR-0-1~95를 **상속**하되, 아래 FR-0-96은 FR-0-78·88("엔진을 수정하지 않는다")의 **의도된 예외**다.

| ID | 요구사항 | 비고 |
|---|---|---|
| FR-0-96 | **엔진 수정은 닫힌 목록으로 한정한다**: ① `executeOutputs`의 `API_CONDITION` v2 분기(정지점 생성) ② 재진입 함수(`resumeAfterApiCall` — 이름은 architect) ③ 순수 함수 3종(경로 추출 · 조건 판정 · `{api.*}` 치환) ④ `getOutgoingNodeRefs`의 참조 편입(J-17) ⑤ `resolveTurn`/`resolveResponse` 결과 타입에 선택 필드 `apiCall?` 추가. **엔진은 여전히 I/O·타이머·`fetch`·Nest·Prisma 심볼 0건**이며 정적 검사로 단언한다. | J-4, ADR-0008 보론 |
| FR-0-97 | **API 노드가 없는 번들에서 모든 소비자의 결과가 바이트 단위로 동일**하다(공개 대화·시뮬레이션·비교·TC). 기존 엔진·통계·검증 테스트가 **수정 없이** 통과한다(v1 `API_CONDITION`의 `unsupportedOutputs` 기록 포함). | 회귀 방지 |
| FR-0-98 | **시크릿은 DB·노드·번들·스냅샷·API 응답·감사로그·서버 로그·트레이스·`ApiCallLog` 어디에도 존재하지 않는다.** 시크릿 값의 유일한 원천은 환경변수이며, 읽는 곳은 `LegacyApiHttpClient`(또는 그 전용 시크릿 리졸버) **1곳**이다. | J-3, 개발명세서 291행 ⑤ |
| FR-0-99 | **레거시 호출의 유일한 출구는 `LegacyApiHttpClient` 1개 클래스**다. 다른 코드는 연결 기준 URL로 `fetch`/HTTP 클라이언트를 호출하지 않는다. 공개 메서드는 **"연결 id + 검증된 요청 명세"만** 받고 **임의 URL 문자열을 받지 않는다**. 정적 검사(`legacy-api-sealing.spec.ts`)로 단언한다. | ADR-0022 §1·§3 형식 |
| FR-0-100 | **`@Public()` 핸들러는 여전히 정확히 6개**다. 레거시 프록시 엔드포인트를 만들지 않는다(ADR-0022 §8과 같은 이유 — 프록시는 봉인을 무의미하게 만든다). | FR-0-85 상속 |
| FR-0-101 | **대화 상태 봉투(`ConversationState`)의 형식·버전을 바꾸지 않는다**(`CONVERSATION_STATE_VERSION` 1 유지). API 응답값은 상태에 들어가지 않는다. | J-9, ADR-0009 |
| FR-0-102 | TC 실행·비교 실행·스냅샷 캡처/복원·예약 배포 실행기는 **`LegacyApiHttpClient`를 주입하지 않는다**(DI 그래프 부재로 호출 불가). | J-15, ADR-0030 형식 |
| FR-0-103 | 신규 환경변수는 **전부 선택 · 기본값 있음**이다(§5.5). 하나도 설정하지 않으면 **사설 대역 호출 0 · 시크릿 사용 연결 호출 불가**이며 서버는 정상 기동한다. `LEGACY_API_ENABLED=false`이면 **레거시 아웃바운드 HTTP 0건**(구축형 폐쇄망 증명용). | FR-0-83 상속 |
| FR-0-104 | 신규 `ApiErrorCode`(제안 5종): `API_CONNECTION_IN_USE`(참조 노드가 있는 연결 삭제 — 409) · `API_CONNECTION_TEST_FAILED`(연결 테스트 실패 — 사유 코드 포함, 원문 없음) · `API_OUTPUT_LEGACY_FORMAT`(v1 형태로 저장 시도 — 400) · `API_CONNECTION_NOT_FOUND`(노드 저장 시 존재하지 않는 연결 — 400 `details`) · `LIVE_API_NOT_ALLOWED`(시뮬레이터 실제 호출 조건 불충족 — 403/400, architect). 오류 봉투 형식 불변. | ADR-0003 |
| FR-0-105 | 서버 로그에는 **연결 id · 노드 id · 결과 코드 · HTTP 상태 · 지연 · 응답 바이트**만 남긴다. 해석된 URL(쿼리 포함)·바인딩 값·헤더·본문·응답 본문·예외 메시지 원문(호스트 내부 경로 포함 가능)을 남기지 않는다. | FR-0-87 상속, ADR-0022 §7 ⑥ |

---

## 4. 기능별 요구사항

### 4.1 실행 범위 · 실행 가능 판정 — J-1 · J-16

| ID | 요구사항 |
|---|---|
| FR-L1-1 | `UNSUPPORTED_OUTPUT_TYPES`를 `['SCENARIO', 'SURVEY']`로 줄인다. `SCENARIO`·`SURVEY`의 동작은 불변이다(⚠ P-1). |
| FR-L1-2 | `API_CONDITION` payload는 **v1(레거시 인라인)과 v2(연결 참조)의 합집합**으로 **읽는다**. 판별은 `connectionId` 존재 여부(또는 명시적 `version` 필드 — architect)로 한다. |
| FR-L1-3 | **실행 가능 판정은 타입이 아니라 형태로** 한다 — v2만 실행하고, v1은 기존과 같이 `unsupportedOutputs`에 `API_CONDITION`을 기록하고 건너뛴다(트레이스 코드 구분: `UNSUPPORTED_OUTPUT` + 사유 `LEGACY_FORMAT`). |
| FR-L1-4 | **쓰기 스키마(노드 생성·수정·복사·가져오기)는 v2만 받는다.** v1을 담은 요청은 `400 API_OUTPUT_LEGACY_FORMAT`. 단 **노드 복사**는 원본이 v1이면 `API_CONDITION` 아웃풋을 **복사하지 않고** 결과에 "이전 형식 API 조건 1개는 복사하지 않았습니다"를 알린다(헤더 토큰 복제 차단). |
| FR-L1-5 | 웹 UI의 미지원 배지는 **공유 상수·공유 판정 함수**를 사용한다(`DialogOutputEditor.tsx` 126행의 하드코딩 제거). v2 `API_CONDITION`에는 배지가 없고, v1에는 "이전 형식 — 실행되지 않음" 배지를 표시한다. |
| FR-L1-6 | 노드 조회 API 응답에서 **v1의 `headers` 값은 제거**하고 **키 목록과 개수만** 반환한다(VIEWER 평문 열람 차단 — §1.2.1). `url`은 호스트까지만 표시(경로·쿼리 제거). 이 변환은 응답 직렬화 1곳에서 한다. ⚠ 버전 내용 조회(No.25) 응답에도 동일 적용 |

### 4.2 API 연결 레지스트리 — J-2 · J-3 · J-14

#### 4.2.1 연결 정의

| 필드 | 규칙 |
|---|---|
| `name` | 1~50자, 정규화 유일(ADR-0006) |
| `description` | 0~300자 |
| `baseUrl` | `SafeUrlSchema` + 쿼리·프래그먼트·사용자정보(`user:pass@`) 금지. 스킴+호스트+포트+기준 경로. `http`는 허용하되 설계 점검·연결 화면에 **"암호화되지 않은 연결"** 경고 |
| `allowedMethods` | `GET`/`POST` 부분집합, 1개 이상(J-7) |
| `authType` | `NONE` · `API_KEY_HEADER`(헤더 이름 지정) · `BEARER` · `BASIC`(시크릿 값 = `user:password`) |
| `authHeaderName` | `API_KEY_HEADER`일 때 필수. 토큰 문자(`^[A-Za-z0-9-]{1,64}$`), `Host`·`Content-Length`·`Cookie`·`Transfer-Encoding` 등 금지 목록 |
| `secretRef` | `authType≠NONE`이면 필수. `^[A-Z0-9_]{1,40}$`. 실제 값 = 환경변수 `LEGACY_API_SECRET__{secretRef}` |
| `timeoutMs` | 1000~`LEGACY_API_MAX_TIMEOUT_MS`(기본 10000), 기본 `LEGACY_API_DEFAULT_TIMEOUT_MS`(3000) |
| `allowRawPersonalData` | 기본 false(J-12). true로 바꾸는 요청은 **확인 문구 재입력**(파괴적 동작 확인 규약과 같은 방식) |
| `personalDataLookup` | 기본 false(J-19). 편집기·설계 점검 안내 트리거 |
| `rateLimitPerMin` | 1~600, 기본 120(연결 단위, 인스턴스 로컬) |
| `sampleResponses` | 0~5개 `{ label ≤50, httpStatus, body(JSON ≤16KB) }` — **목 전용**, 관리자 작성 데이터 |
| `enabled` | 사용 중지 시 **즉시** 모든 호출이 `CONNECTION_DISABLED` 실패 분기(캐시하지 않음 또는 TTL ≤5초 — architect) |

| ID | 요구사항 |
|---|---|
| FR-L2-1 | 연결 CRUD는 `security:write`, 목록·상세는 `security:read`(ADMIN). 노드 편집기용 **선택 목록**(`id`·`name`·`allowedMethods`·`enabled`·`personalDataLookup`·`hasSample`)은 `dialogue:read`로 연다 — **`baseUrl`·`secretRef`·인증 방식은 포함하지 않는다**. |
| FR-L2-2 | API 응답에 시크릿 값은 **어떤 형태로도** 포함하지 않는다. 대신 `secretStatus: 'NOT_REQUIRED'｜'CONFIGURED'｜'MISSING'`을 반환한다(환경변수 존재 여부만 확인). |
| FR-L2-3 | **참조 중인 연결은 삭제할 수 없다**(`409 API_CONNECTION_IN_USE` + 참조 노드 최대 5건 — 챗봇명·노드명). 사용 중지는 항상 가능하다. ⚠ 스냅샷 안의 참조는 삭제를 막지 않는다(J-18). |
| FR-L2-4 | 연결 생성·수정·삭제·사용 여부 변경은 감사로그 `ApiConnection` 대상으로 기록한다. 화이트리스트: `name`·`baseUrlHost`(호스트만)·`allowedMethods`·`authType`·`secretRef`(이름 — 값 아님)·`allowRawPersonalData`·`personalDataLookup`·`timeoutMs`·`enabled`. `sampleResponses` 본문은 기록하지 않는다(개수만). |
| FR-L2-5 | **연결 테스트**(`POST /api-connections/:id/test`, `security:write`): 관리자가 지정한 **GET 상대 경로 1개**(기본 `/`)를 실제 호출한다. SSRF 검사·타임아웃·크기 상한은 대화 경로와 **동일한 클라이언트**를 쓴다. 결과는 `{ outcome, httpStatus?, latencyMs, contentType?, bytes?, jsonParsable }`만 반환하고 **응답 본문을 반환하지 않는다**. `ApiCallLog`에 `source=CONNECTION_TEST`로 기록. |
| FR-L2-6 | 연결은 **전역**(챗봇 스코프 아님)이다 — 레거시 시스템은 여러 챗봇이 공유한다. 멀티테넌시 없음(ADR-0015)과 일치. ⚠ 챗봇별 사용 허용 목록은 범위 밖(§9). |
| FR-L2-7 | 연결 목록에 **참조 노드 수**와 **최근 24시간 호출·실패 수**(`ApiCallLog` 집계)를 표시한다. |

### 4.3 API 조건 아웃풋 v2 — J-6 · J-7 · J-8 · J-17

#### 4.3.1 v2 payload (개요 — 확정은 architect)

```
API_CONDITION v2 = {
  connectionId: uuid,
  method: 'GET' | 'POST',
  path: string ≤ 300          // 연결 기준 경로 뒤에 붙는 상대 경로. `{0}`~`{4}` 자리표시자만 허용
  pathParams?: Binding[] ≤ 5   // 자리표시자 순서대로
  query?: { name ≤ 50, value: Binding }[] ≤ 20
  body?: { field ≤ 100 (점 표기 최대 깊이 3), value: Binding }[] ≤ 30     // POST만
  responseMappings?: { name(^[a-zA-Z][a-zA-Z0-9_]{0,29}$), path ≤ 200, required: boolean, maxLength 1~500(기본 200) }[] ≤ 20
  conditions: { path ≤ 200, operator: 기존 8종, value? ≤ 500, nextNodeId: uuid }[] 1~10   // 기존 필드 그대로
  defaultNodeId?: uuid         // 불일치
  failureNodeId?: uuid         // 호출 실패·필수 매핑 누락·바인딩 누락
}
Binding = { kind: 'CONST', value ≤ 500 } | { kind: 'SLOT', contextVariableId: uuid, slotName }
```

| ID | 요구사항 |
|---|---|
| FR-L3-1 | 저장 시 서버 검증: 연결 존재(`API_CONNECTION_NOT_FOUND`) · 메서드 ∈ 연결 `allowedMethods` · 자리표시자 수 = `pathParams` 수 · `path`에 `..`·`//`·스킴·`?`·`#` 금지(쿼리는 `query`로만) · `body`는 POST만 · SLOT 바인딩의 폼·슬롯 존재 · 매핑 이름 유일 · **모든 노드 참조(`nextNodeId`·`defaultNodeId`·`failureNodeId`) 존재**. 오류는 기존 `details[]` 형식. |
| FR-L3-2 | **노드 참조 무결성 편입(J-17)**: `nextNodeId`·`defaultNodeId`·`failureNodeId`(v1은 `nextNodeId`)를 ① 저장 검증(`dialog-nodes.service.ts` 92~104행 확장) ② 노드 삭제 409 `NODE_IN_USE`(`reference-check.service.ts` 131~157행 확장) ③ `getOutgoingNodeRefs`(`design-validator.ts` 5~18행 — 신규 분류 `apiTargets`, 들어오는 참조 수·고아 판정·흐름 요약에 반영) ④ 스냅샷 무결성 경고(`snapshot-integrity.ts` 83~101행 — `BROKEN_REFERENCE_NODE_API`)에 편입한다. |
| FR-L3-3 | SLOT 바인딩을 쓰는 `API_CONDITION`이 **해당 폼 완료를 조건으로 갖지 않는 노드**(또는 버튼 NODE 액션·`DIALOG_MOVE`로만 도달 가능)에 있으면 설계 점검 **WARNING** "이 노드는 폼 완료 직후가 아닐 때도 실행될 수 있어 값이 비어 실패 분기로 갑니다". |
| FR-L3-4 | 설계 점검 신규 항목: ① `API_CONDITION` 뒤에 아웃풋이 있음(WARNING — 실행되지 않음, J-6) ② 한 노드에 `API_CONDITION` 2개 이상(ERROR — 첫 번째만 의미가 있음) ③ 분기 대상 노드가 또 `API_CONDITION`을 가짐(WARNING — 턴당 1회 제한으로 실행되지 않음) ④ 참조 연결이 사용 중지·시크릿 미설정(WARNING) ⑤ `http` 연결(INFO) ⑥ 개인정보 조회형 연결(INFO, J-19) ⑦ v1 형식(WARNING, "전환 필요") ⑧ `failureNodeId` 미지정(INFO — 고정 문구로 안내됨). |
| FR-L3-5 | 한 노드의 아웃풋 상한(10개, `dialogue.ts` 595행)은 불변. 노드 복사는 v2 `API_CONDITION`을 그대로 복사한다(시크릿이 없으므로). |

### 4.4 대화 실행 — J-4 · J-5 · J-6 · J-9 · J-10

#### 4.4.1 엔진(순수)

| ID | 요구사항 |
|---|---|
| FR-L4-1 | `executeOutputs`가 v2 `API_CONDITION`을 만나면 **그때까지의 출력(carry)** · **재개 위치**(노드 id·아웃풋 인덱스) · **현재 hop 수** · **해석된 호출 명세**(연결 id·메서드·경로 템플릿·바인딩 값) · **세션 전이 후보**를 담은 `apiCall`을 반환하고 실행을 멈춘다. 뒤의 아웃풋은 실행하지 않는다(J-6). |
| FR-L4-2 | 바인딩 해석: `CONST`는 그대로. `SLOT`은 **이번 턴에 완료된 폼**(`resolver.ts` 201~204행의 완료 세션 `filledValues`)의 값만 쓴다. 해당 폼이 이번 턴에 완료되지 않았거나 슬롯 값이 비면 **호출하지 않고** `BINDING_MISSING`으로 실패 분기한다. |
| FR-L4-3 | **순수 함수 3종**(엔진 패키지, 외부 라이브러리 무의존): ① `extractPath(json, path)` — 문법 = 점 표기 + 0 이상 정수 인덱스(`data.items[0].status`), **와일드카드·필터식·재귀 하강·스크립트 없음**, 키에 `__proto__`/`constructor`/`prototype` 금지, 깊이 상한 10 ② `evaluateConditions(json, conditions)` — 위에서부터 첫 일치, 연산자 의미는 §4.4.3 ③ `renderApiTokens(text, vars)` — `{api.이름}`만 치환, 그 외 `{...}`는 **문자 그대로 유지**. |
| FR-L4-4 | 재진입(`resumeAfterApiCall`): 입력 = `apiCall` + 호출 결과(`{ kind: SUCCESS, json } ｜ { kind: FAILURE, reason }`). 성공이면 매핑 → 필수 누락 시 `MAPPING_MISSING` 실패 분기 → 조건 판정 → 선택된 노드의 outputs를 실행하되 **텍스트 필드의 `{api.*}` 토큰만 치환**(J-10). hop 수는 이어서 센다(`HOP_LIMIT` 10 — `constants.ts` 3행 — 분기 이동을 hop 1로 계산). |
| FR-L4-5 | **턴당 외부 호출 1회**: 재진입 후 실행 중 또 `API_CONDITION`을 만나면 호출하지 않고 트레이스 `API_CALL_LIMIT` + 해당 아웃풋의 `failureNodeId`(없으면 고정 문구)로 처리한다. |
| FR-L4-6 | 분기 대상 노드가 없거나 비활성이면 `BROKEN_REFERENCE` 트레이스 + 고정 문구(기존 `DIALOG_MOVE` 처리와 같은 방식, `outputs.ts` 85~89행). |
| FR-L4-7 | 치환 값 정규화: 문자열화(숫자·불리언은 `String()`, 객체·배열은 **치환하지 않고 빈 문자열** + 트레이스) · 제어문자 제거 · 매핑 `maxLength` 절단 · 치환 후 `TEXT`가 1000자(`dialogue.ts` 453행)를 넘으면 절단. **URL 필드에 `{api.*}`가 있으면 치환하지 않는다**(저장 시에도 WARNING). |
| FR-L4-8 | 고정 문구(엔진 상수, 내부 용어 금지 — FR-N2-24 규약): 실패 "지금은 요청하신 정보를 확인할 수 없어요. 잠시 후 다시 시도해 주세요." · 불일치 "확인한 결과에 맞는 안내를 찾지 못했어요. 다른 방법으로 문의해 주세요." 문구 커스터마이즈는 분기 노드로 한다. |
| FR-L4-9 | `apiCall`을 **처리하지 않는 소비자**(방어적 기본)가 결과를 그대로 쓰면, 엔진은 이미 **"호출 실패"와 같은 출력**(carry + 실패 분기 or 고정 문구)을 담은 폴백 결과를 함께 제공한다 — 어떤 소비자도 빈 응답을 받지 않는다(FR-E-9 최소 1건 보장 유지). 구체 표현(폴백 결과 동봉 vs 소비자가 `resume(FAILURE)` 호출)은 architect. |
| FR-L4-10 | 트레이스 신규 코드(제안): `API_CALL_REQUESTED` · `API_CALL_SUCCEEDED` · `API_CALL_FAILED`(사유) · `API_BRANCH_MATCHED`(조건 인덱스) · `API_BRANCH_DEFAULT` · `API_BRANCH_FAILURE` · `API_MAPPING_MISSING` · `API_CALL_LIMIT` · `API_MOCKED`. **트레이스에 바인딩 값·응답 값을 넣지 않는다**(관리자 시뮬레이터 응답의 변수 표시는 별도 필드 — FR-L7-3). |

#### 4.4.2 API 계층(`LegacyApiService`)

| ID | 요구사항 |
|---|---|
| FR-L4-11 | 공개 대화 파이프라인에서 `resolveTurn` 결과에 `apiCall`이 있으면: 연결 조회 → `enabled`·시크릿 확인 → 회로·연결 레이트리밋 확인 → 송신 값 처리(J-12) → `LegacyApiHttpClient` 호출 → 엔진 순수 함수로 결과 판정 → 재진입 → **그 뒤에** 기존 ⑤.5 출구 금지어 필터 · ⑦ RAG 판정 · ⑩ 로그 순서를 그대로 탄다. |
| FR-L4-12 | **RAG(2단계)와의 관계**: API 분기로 끝난 턴은 `judgeAnswered`상 노드 응답이므로 RAG 대상이 아니다. 실패·불일치 **고정 문구**로 끝난 턴도 RAG로 넘기지 않는다(외부 장애를 문서 검색으로 덮으면 사용자가 틀린 답을 받는다). |
| FR-L4-13 | **대화로그**: `ConversationLog`는 기존대로 기록(`matchedNodeId` = 최초 매칭 노드, `botResponse` = 치환된 최종 출력 — 기존 PII 마스킹 경유). 고정 실패 문구로 끝난 턴은 `isAnswered=false`로 기록하되 **미응답 질문 큐에는 적재하지 않는다**(학습 공백이 아니라 외부 장애 — 수집 판정 함수에 사유 추가, ADR-0019). ⚠ 판정식 변경은 architect 확인 |
| FR-L4-14 | 출력 관련: `renderOutbound` · `maskOutbound`는 재진입 후 **최종 출력 전체**에 한 번 적용된다(외부 값 포함). 외부 값이라고 예외를 두지 않는다(개발명세서 288행 "외부 RAG 답변도 출구 필터 통과"와 같은 원칙). |

#### 4.4.3 조건 연산자 의미 (기존 8종 유지)

| 연산자 | 의미 |
|---|---|
| `EQ`/`NEQ` | 추출 값을 문자열화해 **대소문자 구분 완전 일치** 비교. 값이 없으면 `EQ`=거짓, `NEQ`=참 |
| `GT`/`GTE`/`LT`/`LTE` | **양쪽이 모두 유한 숫자로 파싱될 때만** 숫자 비교, 아니면 거짓(문자열 사전순 비교 없음) |
| `CONTAINS` | 추출 값이 문자열이면 부분 문자열, 배열이면 **원소 중 문자열화 일치**가 있으면 참 |
| `EXISTS` | 경로에 값이 있고 `null`이 아니면 참(`value` 무시) |

### 4.5 외부 호출 클라이언트 · SSRF · 탄력성 — J-5 · J-7 · J-11

| ID | 요구사항 |
|---|---|
| FR-L5-1 | URL 조립: `baseUrl` + `path`(자리표시자에 **퍼센트 인코딩된** 값 — `/`도 인코딩) + `query`(키·값 모두 인코딩). 조립 결과의 **호스트·포트가 `baseUrl`과 같아야** 한다(다르면 `BLOCKED_URL`). |
| FR-L5-2 | 요청 헤더는 서버가 구성한다: `Accept: application/json` · POST면 `Content-Type: application/json` · 인증 헤더(시크릿) · `User-Agent`(고정 식별자). **노드·연결 어디에서도 임의 헤더를 받지 않는다**(v2 스키마에 헤더 필드 없음). |
| FR-L5-3 | **DNS·IP 검증**: 호스트를 해석한 **모든 주소**를 검사해 하나라도 절대 차단 대역이면 거부하고, **실제 소켓 연결은 검증된 주소로만** 한다(해석과 연결 사이 재바인딩 방지 — 구현 방식은 architect, 예: 커스텀 `lookup`). 절대 차단: `127.0.0.0/8` · `::1` · `0.0.0.0/8` · `::` · `169.254.0.0/16` · `fe80::/10` · 메타데이터 주소(`169.254.169.254`·`fd00:ec2::254`) · 멀티캐스트·브로드캐스트 · IPv4 매핑/호환 IPv6 표기의 위 대역. **IP 리터럴 호스트**(`http://10.0.0.5`)도 같은 검사를 받는다. |
| FR-L5-4 | **사설·내부 대역**(`10/8`·`172.16/12`·`192.168/16`·`100.64/10`·`fc00::/7`)은 `LEGACY_API_PRIVATE_ALLOWLIST`(CIDR·호스트명 목록)에 **포함될 때만** 허용한다. 기본값은 빈 목록(= 사설 대역 전부 거부). 절대 차단 대역은 allowlist에 넣어도 **무시**하고 기동 시 경고 로그를 남긴다. |
| FR-L5-5 | **리다이렉트를 따라가지 않는다** — 3xx 응답은 `REDIRECT_NOT_ALLOWED` 실패. |
| FR-L5-6 | **응답 제한**: 본문을 스트림으로 읽어 `LEGACY_API_MAX_RESPONSE_BYTES`(기본 262144) 초과 시 즉시 중단 → `RESPONSE_TOO_LARGE`. `Content-Type`이 `application/json` 또는 `+json`이 아니면 `INVALID_RESPONSE`. JSON 파싱 실패도 `INVALID_RESPONSE`. |
| FR-L5-7 | **성공 판정**: HTTP 2xx + JSON 파싱 성공. 그 외 상태는 `HTTP_ERROR`(상태 코드 기록). ⚠ 4xx 본문을 분기에 쓰는 요구(예: 404 = "주문 없음")는 **1차에서는 실패 분기로 통일**하고 조건 분기 대상에 넣지 않는다(재검토 트리거 §9). |
| FR-L5-8 | **탄력성**: 연결 단위 ① 타임아웃(연결 설정 — 연결·수신 전체 합산) ② 회로차단(연속 실패 `LEGACY_API_CIRCUIT_FAILURE_THRESHOLD` 5회 → `LEGACY_API_CIRCUIT_OPEN_MS` 60초 동안 호출 없이 `CIRCUIT_OPEN`) ③ 분당 레이트리밋(`rateLimitPerMin`, 초과 시 `RATE_LIMITED`) ④ 동시 요청 상한(기본 10, 초과 시 대기 없이 `RATE_LIMITED`). 상태는 인스턴스 로컬이며 인터페이스 1곳으로 추상화(교체 지점 1곳 — 개발명세서 299행 규약). |
| FR-L5-9 | **재시도하지 않는다**(1차, ⚠ P-5). GET도 공개 대화 지연 예산 안에서 재시도할 여유가 없고, POST는 비멱등이다. `ApiCallLog.retryCount` 컬럼은 두지 않는다. |
| FR-L5-10 | 결과 코드(`ApiCallOutcome`, 제안): `SUCCESS` · `HTTP_ERROR` · `TIMEOUT` · `NETWORK_ERROR` · `BLOCKED_ADDRESS` · `BLOCKED_URL` · `REDIRECT_NOT_ALLOWED` · `RESPONSE_TOO_LARGE` · `INVALID_RESPONSE` · `CIRCUIT_OPEN` · `RATE_LIMITED` · `CONNECTION_DISABLED` · `SECRET_MISSING` · `BINDING_MISSING` · `MAPPING_MISSING` · `FEATURE_DISABLED`. 사용자 화면에는 코드가 드러나지 않는다(고정 문구·분기 노드만). |

### 4.6 개인정보 · 금지어 · 감사 — J-12 · J-13 · J-19

| ID | 요구사항 |
|---|---|
| FR-L6-1 | 송신 값 처리: 연결 `allowRawPersonalData=false`이면 **SLOT 바인딩 값**에 `maskPii()`(`packages/pii-mask` — 복제 금지)를 적용한 뒤 송신한다. `CONST`는 관리자 작성 값이라 적용하지 않는다(TC 문장 비적용 선례 — 개발명세서 293행 ⑥). |
| FR-L6-2 | `allowRawPersonalData=true` 연결은 원문을 송신한다. 이 설정의 변경은 감사로그에 남고, 연결 목록·노드 편집기·설계 점검에 **"원문 송신"** 배지가 텍스트로 보인다. ADR-0013의 적용 지점 목록에 "레거시 송신(연결 단위 예외 가능)"을 추가한다(§10). |
| FR-L6-3 | 마스킹으로 값이 바뀌었는데(예: `010-****-1234`) 원문 송신이 꺼져 있으면, 호출은 하되(관리자 설정 존중) `ApiCallLog`에 `personalDataMasked=true`를 남겨 "마스킹 때문에 조회 실패" 원인 추적을 돕는다. 편집기는 폼 슬롯 유형이 전화·이메일 등이면 "이 연결은 원문 송신이 꺼져 있어 마스킹된 값이 전송됩니다" 안내. |
| FR-L6-4 | **`ApiCallLog`** 적재(쓰기 주체 = `ApiCallLogService.record()` 1곳, fire-and-forget — 응답 경로 대기 없음). 필드는 §5.2. **원문 필드 0**을 zod 스키마·정적 검사로 단언한다. |
| FR-L6-5 | `ApiCallLog`에 남기는 출처: `PUBLIC`(공개 대화) · `SIMULATION_LIVE`(시뮬레이터 실제 호출) · `CONNECTION_TEST`. **목 실행·TC·비교는 기록하지 않는다**(ADR-0030 ① 과 같은 원칙 — 운영 지표 오염 방지). |
| FR-L6-6 | 챗봇 영구삭제 시 해당 챗봇의 `ApiCallLog`를 동반 삭제한다(`RagCallLog`와 같은 처리 — FK 없음 · 서비스가 정리). ⚠ ADR-0033의 "로그 삭제 0건" 봉인은 `ConversationLog`·`UnansweredQuestion` 대상이므로 저촉되지 않음 — architect 확인 |
| FR-L6-7 | 감사로그: 연결 CRUD(FR-L2-4)만 기록. **호출 1건 1건은 감사로그가 아니다**(ADR-0016 §5). 노드 저장 감사는 기존 그대로(`outputs`는 화이트리스트 밖 — `audit-snapshot.ts` 39행). |
| FR-L6-8 | 개인정보 조회형 연결(`personalDataLookup=true`)은 레이트리밋 기본값을 **30/분**으로 낮춰 생성하고, 편집기에 "익명 사용자가 다른 사람의 번호로 조회할 수 있습니다 — 레거시 쪽에서 2개 이상의 정보를 대조하도록 설정하세요" 안내를 표시한다(J-19). |
| FR-L6-9 | 입구 금지어 필터는 기존대로 사용자 입력에 적용되므로 SLOT 값은 이미 통과한 값이다. 외부 응답값이 치환된 출력은 출구 필터(마스킹)를 통과한다(FR-L4-14). **관리자 시뮬레이터에는 금지어 필터를 적용하지 않는 기존 규약**(개발명세서 288행)은 불변. |

### 4.7 시뮬레이션(No.10) · TC 검증(No.19/20) — J-15

| ID | 요구사항 |
|---|---|
| FR-L7-1 | 시뮬레이터 요청에 선택 필드 `apiMode: 'MOCK' ｜ 'LIVE'`(기본 `MOCK`)와 `mockResponse?`(`{ sampleLabel } ｜ { httpStatus, body ≤16KB } ｜ { failure: ApiCallOutcome }`)를 추가한다. 미지정 목 = 연결의 **첫 번째 샘플 응답**, 샘플이 없으면 `API_MOCKED` + **실패 분기**로 재현한다. |
| FR-L7-2 | `LIVE`는 다음을 **모두** 만족할 때만: 요청자 `simulation:write` · 메서드 GET · 해당 `API_CONDITION`이 **오버레이가 아닌 저장된 노드**에 속함 · 연결 사용 중 · `LEGACY_API_ENABLED`. 불충족 시 `LIVE_API_NOT_ALLOWED`(사유 포함)로 거부하지 않고 **목으로 격하 + 사유 안내** 중 무엇으로 할지는 ui-designer/architect(권고: 격하 + 안내). |
| FR-L7-3 | 시뮬레이터 응답에 `apiStep?: { mode, connectionName, method, pathTemplate, outcome, httpStatus?, latencyMs?, branch, variables: {name: value}[] }`를 추가한다. `variables` 값은 **`maskPii` 적용 후** 보여 준다(관리자 화면에 외부 개인정보를 원문으로 띄우지 않음). 해석된 URL·바인딩 원문은 보여 주지 않는다. |
| FR-L7-4 | **비교 실행(compare)은 항상 목**이며 A/B 양쪽에 **같은 목 응답**을 쓴다(비교의 결정론). |
| FR-L7-5 | **TC 대량 실행은 항상 목**이다. 목 원천 = 연결의 첫 번째 샘플(없으면 실패 분기). TC 결과에 `API 목 판정` 배지를 붙인다. 기존 `일부 아웃풋 미실행` 배지(FR-V1-31)는 v1 형식 `API_CONDITION`과 `SCENARIO`·`SURVEY`에만 남는다. |
| FR-L7-6 | ⚠ **응답 해시 불연속**: v2 `API_CONDITION`을 포함한 TC는 No.26 적용 전 실행(미지원 폴백 문구)과 후 실행(목 분기 출력)의 응답 해시가 다르다. 실행 비교 화면에 "외부 API 실행 도입 전후 실행은 비교 결과가 달라질 수 있습니다" 안내를 1회 표시한다(ADR-0029 버전 축 설명과 연계 — architect). 샘플 응답 변경도 해시를 바꾸므로 TC 결과에 **사용된 샘플의 해시 앞 8자리**를 기록한다. |
| FR-L7-7 | 시뮬레이터·TC 실행은 `ConversationLog`·`UnansweredQuestion`을 만들지 않는 기존 규약 불변. 시뮬레이터 `LIVE`만 `ApiCallLog`(`SIMULATION_LIVE`)를 남긴다. |

### 4.8 버전(No.25) · 예약 배포(No.28) — J-18

| ID | 요구사항 |
|---|---|
| FR-L8-1 | 스냅샷은 노드 `outputs`를 **그대로** 담는다(v1·v2 모두). `ApiConnection`은 스냅샷 대상이 아니며 스냅샷 스키마 버전(`SNAPSHOT_SCHEMA_VERSION`)을 올리지 않는다(읽기 스키마가 v1∪v2라 업캐스터 불필요). ⚠ 스냅샷 해시 정규화(`snapshot-canonical.ts`)가 v2 필드 순서에 안정적인지 architect 확인 |
| FR-L8-2 | 복원 미리보기 경고 신규: `API_CONNECTION_MISSING`(대상 버전이 참조하는 연결 없음) · `API_CONNECTION_DISABLED` · `API_LEGACY_FORMAT`(대상 버전에 v1 형식 포함 — "복원 후 실행되지 않습니다"). 전부 **경고**(blocker 아님). |
| FR-L8-3 | ⚠ **v1 스냅샷의 평문 헤더**: 과거 스냅샷에 v1 헤더 토큰이 남아 있을 수 있다. 버전 **내용 조회 응답**에는 FR-L1-6과 같은 가림을 적용하고, 버전 목록에 "이전 형식 API 조건 포함(헤더 값 저장됨)" 표시를 둔다. 제거가 필요하면 **해당 버전 삭제**(No.25 기존 기능)로 한다 — 스냅샷 본문 수정 경로를 만들지 않는다(해시 불변 원칙, ADR-0031). |
| FR-L8-4 | 예약 배포(No.28) 변경 0. 준비도 경고(G0')에 "대상 버전의 API 연결 미존재/사용 중지"를 추가하는 것은 **선택**(권고: FR-L8-2 경고를 재사용해 자동 포함). |
| FR-L8-5 | 연결 삭제 409(FR-L2-3)는 **현재 노드 참조만** 검사하고 스냅샷 참조는 검사하지 않는다(스냅샷 때문에 연결을 영원히 못 지우는 것을 방지). |

### 4.9 관리자 콘솔 요구사항 (`apps/web`)

| ID | 요구사항 |
|---|---|
| FR-L9-1 | **보안 설정 > API 연결** 화면(ADMIN): 목록(이름·호스트·메서드·인증 방식·시크릿 상태·원문 송신·개인정보 조회형·사용 여부·참조 노드 수·24시간 호출/실패) · 생성/수정 대화상자 · 연결 테스트(상대 경로 입력 · 결과 요약) · 샘플 응답 편집(JSON 입력 + 형식 검증) · 삭제(참조 시 409 목록 안내). |
| FR-L9-2 | **노드 편집기 `API 조건분기` v2 폼**: 연결 선택(선택 목록 API) → 메서드(연결 허용분만) → 경로 + 자리표시자 값(상수/폼 슬롯 선택기) → 쿼리 목록 → 본문 필드 목록(POST) → 응답 매핑 목록 → 조건 목록(기존 편집기 재사용) → 기본/실패 분기 노드 → **샘플 응답으로 미리보기**(매핑 결과·선택 분기를 즉시 표시, 서버 순수 함수 호출 또는 공유 함수). 헤더·URL 직접 입력 필드는 **없다**. |
| FR-L9-3 | v1 노드 표시: "이전 형식 — 실행되지 않음" 배지 · 헤더 **값 미표시**(키·개수만) · `연결로 전환` 버튼(메서드·경로 일부·조건을 v2 폼으로 옮기고 연결 선택을 요구, 헤더·url·bodyTemplate은 버림 — 사용자 확인 대화상자). |
| FR-L9-4 | 배포 직후 1회성 **v1 잔존 현황**(관리자 대시보드 알림 또는 설계 점검 요약): "이전 형식 API 조건 N건(노드) · 버전 M건" — 수치 산출은 읽기 전용 스크립트/조회로(자동 변경 없음). |
| FR-L9-5 | 시뮬레이터: 결과 패널에 `외부 API` 단계(모드·연결명·결과·분기·변수) · 목 선택(샘플 목록/직접 입력/실패 유형) · `실제 호출` 토글(조건 불충족 시 비활성 + 사유 텍스트). |
| FR-L9-6 | 챗봇 상세 **`외부 연동 로그`** 탭(`chatbot:read`): 기간(KST)·연결·결과 필터, 요약(호출 수·성공률·결과 코드 분포·P95 지연), 목록(시각·연결·메서드·경로 템플릿·HTTP 상태·지연·분기) — 페이지네이션 필수(기본 50). |
| FR-L9-7 | 사용자 화면·위젯에 "API"·"HTTP"·"타임아웃" 같은 내부 용어를 쓰지 않는다(FR-N2-24 규약 — 고정 문구 FR-L4-8). |

### 4.10 다른 기능과의 경계 (혼동 방지)

| 기능 | 이 그룹과의 관계 |
|---|---|
| **No.5 대화 설계**(구현 완료) | `API_CONDITION` 스키마를 v2로 확장·v1 읽기 호환. `SCENARIO`·`SURVEY` 불변 |
| **No.8 컨텍스트**(구현 완료) | 폼 슬롯 값을 **요청 바인딩 원천**으로만 읽는다. 폼 정의·세션 상태 형식 불변(FR-0-101). 응답값을 슬롯에 쓰지 않는다(J-9) |
| **No.10 시뮬레이션 · No.19/20 검증**(구현 완료) | 목 기본 · 시뮬레이터 LIVE opt-in · TC/비교 항상 목(§4.7) |
| **No.25 버전 · No.28 예약 배포**(구현 완료) | 연결은 스냅샷 밖 · 참조 경고만(§4.8) |
| **No.30 외부 RAG**(구현 완료) | 별개 출구·별개 로그. `RagHttpClient`를 재사용하지 않는다(용도·봉인 방식이 다름). API 실패 턴을 RAG로 넘기지 않는다(FR-L4-12) |
| **No.39 커넥터 허브**(미구현) | **표준 커넥터(ERP/CRM/결제 템플릿)·`SCENARIO` 실행**은 No.39. 이 그룹의 `ApiConnection`이 그 토대(연결 = 커넥터 인스턴스) |
| **No.41 워크플로우 커넥터**(미구현) | 승인·티켓 생성 같은 **후속 액션 자동 실행**·비동기 콜백·재시도 큐는 No.41. 이 그룹은 **동기 조회/단발 POST**만 |
| **No.45 데이터 거버넌스**(미구현) | 시크릿 DB 암호화 저장·`ApiCallLog`/`RagCallLog`/대화로그 보존기간 자동 정리는 No.45 |
| **No.27 설문관리**(미구현) | `SURVEY` 미지원 유지 |

### 4.11 구축형 / 구독형 적합도

| 형태 | 적합도 | 근거 · 전제조건 |
|---|:---:|---|
| 구축형 | ○ | **주 무대.** 사내 레거시는 사설 대역에 있으므로 운영자가 `LEGACY_API_PRIVATE_ALLOWLIST`로 연다(FR-L5-4). 시크릿은 서버 환경변수(운영자 관리가 자연스럽다). 폐쇄망 증명은 `LEGACY_API_ENABLED=false`로 아웃바운드 0건(FR-0-103). ⚠ 루프백 절대 차단 때문에 **같은 서버에 설치된 레거시**는 호출할 수 없다 — 사내 DNS 이름/사설 IP로 노출해야 한다(EX-L-12) |
| 구독형 | ○(전제) | 고객 레거시가 **인터넷에서 HTTPS로 도달 가능**해야 하고, 고객 방화벽에 우리 **고정 송신 IP**를 등록해야 한다(인프라 요구 — `docs/05-ops/자동배포.md` 착수 시 반영). 사설 allowlist는 사용하지 않는다(빈 값 유지 권고). 시크릿 추가가 운영자 작업이라 **셀프서비스가 아니다** — 고객 수가 늘면 No.45 DB 암호화로 전환(재검토 트리거). 다중 인스턴스에서 회로·레이트 카운터는 인스턴스별(정확한 전역 한도 아님 — 기존 RAG와 같은 수용) |

### 4.12 GPU 필요도 재확인 — J-20

| No | 카탈로그 | **재확인** | 근거 |
|---|:---:|:---:|---|
| **26** | 1 | **1 유지** | HTTP 1회 · JSON 파싱(≤256KB) · 경로 추출 · 문자열 치환뿐이며 §1 기준표 "1~2 CPU 전용"에 해당한다. **새 모델·추론·임베딩 0건.** ml-worker를 호출하지 않는다 |

---

## 5. 데이터 요구사항

### 5.1 기존 자산 재사용 (변경 없음 또는 최소 변경)

| 자산 | 사용 | 변경 |
|---|---|---|
| `ApiConditionOutputPayloadSchema`(`dialogue.ts` 524~530행) | v1 읽기 | 읽기용 v1 ∪ v2 · 쓰기용 v2 분리(FR-L1-2/4) |
| `UNSUPPORTED_OUTPUT_TYPES`(432행) | 미지원 판정 | `API_CONDITION` 제거 + **형태 판정 함수** 추가(FR-L1-3) |
| `executeOutputs`·`resolveResponse`·`resolveTurn` | 정지점·재진입 | FR-0-96 닫힌 목록 |
| `getOutgoingNodeRefs`(`design-validator.ts` 5~18행) | 참조 편입 | `apiTargets` 추가(FR-L3-2) |
| `dialog-nodes.service.ts` 참조 검증 · `reference-check.service.ts` 삭제 검사 · `snapshot-integrity.ts` | 참조 편입 | 각 1블록 확장 |
| `maskPii`(`packages/pii-mask`) | 송신 값 · 시뮬레이터 변수 표시 | 없음(호출만) |
| `BannedWordFilterService.maskOutbound` | 최종 출력 | 없음 |
| `ConversationLogService.record()` · 미응답 수집 판정 | 실패 문구 턴 | 수집 제외 사유 1건(FR-L4-13) |
| `AuditLogService` · `AUDIT_FIELDS` | 연결 CRUD | `ApiConnection` 대상 추가 |
| `ChatbotsService.permanentDelete()` | `ApiCallLog` 동반 삭제 | `deleteMany` 1건 |
| 스냅샷 복원 미리보기 경고 | 연결 참조 경고 | 경고 규칙 3종(FR-L8-2) |
| `DialogOutputEditor.tsx` · 시뮬레이터 화면 | v2 폼 · API 단계 표시 | 재작성(ApiConditionEditor) · 확장 |

### 5.2 신규 데이터 모델 제안 (`system-architect` 확정 사항)

| 테이블 | 목적 | 핵심 컬럼(개요) | 판단 근거 |
|---|---|---|---|
| **`ApiConnection`** | 전역 연결 레지스트리 | `id` · `name`/`nameNormalized`(유일) · `description?` · `baseUrl` · `allowedMethods`(JSON 배열) · `authType` · `authHeaderName?` · `secretRef?` · `timeoutMs` · `rateLimitPerMin` · `allowRawPersonalData` · `personalDataLookup` · `sampleResponses`(JSON, ≤5개·각 16KB) · `enabled` · `createdAt`/`updatedAt` | 쓰기 주체 = 연결 서비스 1곳. **시크릿 값 컬럼 없음**(J-3). 노드 → 연결 참조는 JSON 안이라 FK 없음(앱 레벨 검사, `outputs` JSON 규약 — schema.prisma 165~166행) |
| **`ApiCallLog`** | 호출 관측(개발명세서 198행 예고의 실체화) | `id` · `chatbotId`(FK 없음) · `connectionId`(FK 없음 — 연결 삭제 후에도 로그 보존) · `nodeId?` · `conversationLogId?` · `source`(`PUBLIC`·`SIMULATION_LIVE`·`CONNECTION_TEST`) · `method` · `pathTemplate`(치환 전) · `outcome` · `httpStatus?` · `latencyMs` · `responseBytes?` · `branch`(`CONDITION_n`·`DEFAULT`·`FAILURE`·`NOTICE`) · `personalDataMasked` · `dayBucket`(KST, ADR-0017) · `createdAt` · `@@index([chatbotId, dayBucket])` · `@@index([connectionId, createdAt])` | `RagCallLog`(schema.prisma 482~507행) 형식. **URL 치환값·헤더·본문·응답 원문 컬럼 없음** |

**만들지 않는 것**: 시크릿 저장 테이블 · 요청/응답 원문 로그 · 챗봇↔연결 허용 조인 테이블 · 재시도 큐 · 호출 결과 캐시 · 대화 세션 변수 저장소.

### 5.3 `shared-types` 스키마

`packages/shared-types/src/legacy-api.ts` **신설** 제안(위젯 번들 비유입 — ADR-0003 §9 배치 규칙).

- `ApiConnectionAuthType` · `ApiCallOutcome`(16종, FR-L5-10) · `ApiCallSource` · `ApiCallBranch`
- `ApiConnectionSchema`(응답 — 시크릿 값 필드 **존재하지 않음**, `secretStatus` 포함) · `CreateApiConnectionSchema` · `UpdateApiConnectionSchema` · `ApiConnectionPickerItemSchema`(FR-L2-1) · `ApiConnectionTestRequest/ResultSchema`
- `ApiBindingSchema` · `ApiConditionOutputPayloadV2Schema` · `ApiConditionOutputPayloadV1Schema`(기존 이동) · 읽기/쓰기 `DialogOutput` 스키마 분리(architect — `dialogue.ts` 532~545행)
- `ApiCallLogItemSchema` · `ApiCallLogSummarySchema` · 목록 쿼리 스키마
- 시뮬레이터 확장: `SimulateRequestSchema`에 `apiMode?`·`mockResponse?`, 응답에 `apiStep?`
- `TraceCode` 신규(FR-L4-10) · `AuditTargetType`에 `ApiConnection` · `ApiErrorCode` 5종(FR-0-104)
- 경로 문법 상수(최대 깊이·금지 키)는 **엔진 순수 함수와 FE 미리보기가 공유**하는 코드 1곳

### 5.4 API 엔드포인트 개요

| 메서드 | 경로 | 권한(권고) | 비고 |
|---|---|---|---|
| `GET` | `/api-connections` | `security:read` | 목록(+ 참조 노드 수·24h 통계) |
| `POST` | `/api-connections` | `security:write` | 생성 |
| `GET` | `/api-connections/:id` | `security:read` | 상세(`secretStatus`) |
| `PATCH` | `/api-connections/:id` | `security:write` | 수정(원문 송신 켜기는 확인값) |
| `DELETE` | `/api-connections/:id` | `security:write` | 참조 시 409 |
| `POST` | `/api-connections/:id/test` | `security:write` | 실제 GET 1회 · 본문 미반환 |
| `GET` | `/api-connections/picker` | `dialogue:read` | 노드 편집기용(이름·메서드·상태만) |
| `GET` | `/chatbots/:chatbotId/api-call-logs` | `chatbot:read` | 목록·필터·페이지네이션 |
| `GET` | `/chatbots/:chatbotId/api-call-logs/summary` | `chatbot:read` | 기간 요약 |
| (확장) | `POST /chatbots/:chatbotId/simulate` | 기존 `simulation:read` (+ `LIVE`는 서비스 내 `simulation:write` 재확인) | `apiMode`·`mockResponse` |
| (확장) | 노드 CRUD · 설계 점검 · 버전 미리보기 | 기존 | v2 검증 · 참조 편입 · 경고 |

**`@Public()` 추가 0건**(FR-0-100). **레거시 프록시 경로 0건**.

### 5.5 신규 환경변수 (전부 선택 · 기본값 있음 — FR-0-103)

| 변수 | 기본값 | 설명 |
|---|---|---|
| `LEGACY_API_ENABLED` | `true` | `false`면 모든 레거시 호출이 `FEATURE_DISABLED`(아웃바운드 0) |
| `LEGACY_API_PRIVATE_ALLOWLIST` | (빈 값) | 사설·내부 대역 허용 CIDR/호스트 목록(쉼표 구분). 절대 차단 대역은 무시 + 기동 경고 |
| `LEGACY_API_DEFAULT_TIMEOUT_MS` | `3000` | 연결 생성 시 기본 타임아웃 |
| `LEGACY_API_MAX_TIMEOUT_MS` | `10000` | 연결 타임아웃 상한(하한 1000) |
| `LEGACY_API_MAX_RESPONSE_BYTES` | `262144` | 응답 크기 상한(상한 1MB) |
| `LEGACY_API_CIRCUIT_FAILURE_THRESHOLD` | `5` | 연결 단위 회로 개방 연속 실패 수 |
| `LEGACY_API_CIRCUIT_OPEN_MS` | `60000` | 회로 개방 유지 시간 |
| `LEGACY_API_SECRET__<REF>` | — | 연결 시크릿(`secretRef`별). **env 검증 스키마에 개별 등록하지 않고 접두사 규약으로 읽는다**(값을 로그·오류에 출력 금지) |

---

## 6. 비기능 요구사항

### 6.1 성능 (NFR-LP)

| ID | 요구사항 |
|---|---|
| NFR-LP1 | **API 노드가 없는 턴**: 공개 대화 API P95 500ms(번들 캐시 적중) **불변** — 추가 조회 0, 엔진 분기 비용만(측정 오차 범위). |
| NFR-LP2 | **API 턴**: P95 ≤ 기존 예산 + **외부 응답시간** + 우리 오버헤드 **50ms**(연결 조회·DNS 검증·파싱·매핑·재진입). 최악 = 연결 타임아웃 + 500ms. **예산을 못 지킨다고 타임아웃 상한을 조용히 올리지 않는다**(개발명세서 282행 규약 준용). |
| NFR-LP3 | 회로 개방·레이트 초과·연결 사용 중지 시 **외부 대기 없이** 10ms 이내에 실패 분기로 진입. |
| NFR-LP4 | 경로 추출·조건 판정·치환은 256KB 응답·매핑 20개·조건 10개 기준 **5ms 이내**(순수 함수, 단위 벤치). |
| NFR-LP5 | 레거시 응답 대기 중 이벤트 루프를 막지 않는다(스트림 수신). 외부 지연이 **다른 챗봇·관리자 API의 P95를 20% 이상 늘리지 않는다**(동시 요청 상한 FR-L5-8 ④). |
| NFR-LP6 | TC 대량 실행 처리량(500 TC/분 — 개발명세서 284행) **불변** — 목 판정은 순수 함수 호출뿐. |
| NFR-LP7 | 호출 로그 목록 P95 300ms · 요약(30일) P95 1초. `ApiCallLog` 적재는 응답 경로를 대기시키지 않는다. |

### 6.2 보안 / 개인정보 (NFR-LS)

| ID | 요구사항 |
|---|---|
| NFR-LS1 | **SSRF**: FR-L5-1~6 전부. 테스트 필수 대상 — IP 리터럴(10진·8진·16진·축약 표기 `127.1`·`0x7f000001`), IPv6 루프백·매핑 주소, DNS가 사설 IP를 반환하는 공인 도메인, 첫 해석 공인/두 번째 해석 루프백(재바인딩), 3xx → 내부 주소, `user:pass@host`, 포트 변경 경로. |
| NFR-LS2 | **시크릿**: FR-0-98. 오류 메시지·예외 스택·트레이스·응답에 시크릿 **값·길이·접두** 어느 것도 나타나지 않음을 테스트로 단언(가짜 시크릿 문자열 grep). |
| NFR-LS3 | **요청 인젝션**: 슬롯 값에 `/`·`?`·`#`·`%`·`"`·`}`·CRLF·유니코드 제어문자를 넣어도 **경로·쿼리·본문 구조와 헤더가 바뀌지 않는다**(FR-L5-1 · J-8). |
| NFR-LS4 | **응답 신뢰 금지**: 외부 응답은 zod 수준 검증 대상이 아니라 **추출 경로만 읽는다**. 프로토타입 오염 키 금지(FR-L4-3), JSON 파서는 표준 `JSON.parse`(reviver 없음), `eval`·동적 경로 라이브러리 금지(과거 JSONPath 구현체의 원격 코드 실행 취약점 이력 — 자체 순수 함수로 대체). |
| NFR-LS5 | **PII**: FR-L6-1~3. 저장·로그에 송신 값·응답 값 원문 0. 시뮬레이터 변수 표시도 마스킹. |
| NFR-LS6 | **봉인 정적 검사**(`legacy-api-sealing.spec.ts` — `rag-allowlist.spec.ts` 형식): ① `LEGACY_API_SECRET__` 참조가 시크릿 리졸버 1파일에만 ② `LegacyApiHttpClient` 밖에서 연결 `baseUrl`로 HTTP 호출 0 ③ `packages/dialogue-engine`에 `fetch`/`http`/`https`/`undici`/`net`/`dns` 심볼 0 ④ 검증·비교·버전·예약 모듈이 `LegacyApiModule`을 import하지 않음 ⑤ `ApiCallLog` 스키마·서비스에 `body`/`header`/`url`(치환값)/`response` 원문 필드 0 ⑥ `@Public()` 6개 ⑦ v2 스키마에 `headers` 필드 0. |
| NFR-LS7 | 사용자 입력 URL 스킴 규약(`http`/`https` refine) 유지 + 연결 `baseUrl`의 사용자정보·쿼리·프래그먼트 금지. |
| NFR-LS8 | 최종 사용자 개인정보 조회 위험(J-19)은 **수용·표시** 대상이며, 연결 단위 레이트리밋(개인정보 조회형 30/분)과 공개 레이트리밋(세션 30/분·IP 120/분 — 개발명세서 288행)이 중첩 적용된다. |

### 6.3 접근성 (NFR-LA)

| ID | 요구사항 |
|---|---|
| NFR-LA1 | 연결·노드 편집 폼의 모든 입력은 레이블·오류 연결(`aria-describedby`)을 갖고, 목록(쿼리·본문·매핑·조건) 순서 변경은 **위/아래 버튼**(드래그 단독 금지). |
| NFR-LA2 | 상태 배지(`사용 중`/`사용 중지`/`시크릿 미설정`/`원문 송신`/`개인정보 조회형`/`이전 형식`/`목 응답`)는 **색상 + 텍스트**. |
| NFR-LA3 | 연결 테스트·샘플 미리보기 결과는 `aria-live="polite"`. 오류 메시지는 원인과 해결 방법을 함께(UIUX §7 — 예: "사설 주소(10.20.1.5)는 서버 허용 목록에 없어 호출할 수 없습니다. 운영자에게 허용 목록 추가를 요청하세요"). |
| NFR-LA4 | 위젯: API 턴 응답이 길어질 수 있으므로 기존 전송 중 표시가 **텍스트/보조기술 알림**을 포함하는지 ui-designer가 확인(애니메이션 단독 금지 — 개발명세서 298행). 신규 화면 axe **대비 위반 0건**. |

### 6.4 유지보수성 (NFR-LM)

| ID | 요구사항 |
|---|---|
| NFR-LM1 | **경로 추출 · 조건 판정 · 토큰 치환 · URL 조립 · IP 대역 판정 · 결과 코드 → 분기 매핑 · v1/v2 판별**은 DB·Nest·네트워크 무의존 **순수 함수**로 두고 단위 테스트 1차 대상으로 삼는다. |
| NFR-LM2 | DNS 해석·소켓 연결은 **포트 인터페이스**로 추상화해 테스트에서 가짜 리졸버·가짜 서버로 대체한다(실제 외부 네트워크 호출 테스트 0). |
| NFR-LM3 | 회로·레이트·동시성 상태는 인터페이스 1곳(다중 인스턴스 전환 시 교체 지점 1곳). |
| NFR-LM4 | 엔진 정지/재진입은 **소비자 4곳이 같은 헬퍼**(예: `runTurnWithApi(executor)`)를 쓰게 해 분기 복제를 막는다 — 소비자별로 달라지는 것은 **실행기(실제/목)** 하나뿐. |
| NFR-LM5 | 신규 원시 SQL 0건. 신규 의존성은 **0 목표**(Node 내장 `fetch`/`undici`·`dns`·`net`으로 충분 — IP 판정은 자체 구현 또는 검증된 경량 라이브러리 1개, architect). |

---

## 7. 수용기준 (AC)

### AC-L1. 범위 · 호환 · 참조 무결성

- **AC-L1-1** Given v2 `API_CONDITION` 노드, When 시뮬레이터(목)로 매칭시키면, Then `unsupportedOutputs`에 `API_CONDITION`이 **없고** 분기 노드 출력이 나온다.
- **AC-L1-2** ★ Given v1(인라인 url/headers) 노드, When 공개 대화로 매칭시키면, Then **외부 호출 0건**이고 결과는 No.26 이전과 **바이트 단위로 같다**(`unsupportedOutputs` 기록 + 안내 문구 폴백).
- **AC-L1-3** Given v1 형태 payload, When 노드 생성·수정 API로 저장하면, Then `400 API_OUTPUT_LEGACY_FORMAT`이다.
- **AC-L1-4** ★ Given v1 헤더 `Authorization: Bearer secret123`을 가진 노드, When VIEWER가 노드 상세·목록·버전 내용을 조회하면, Then 응답 어디에도 `secret123`이 없고 헤더 키·개수만 있다.
- **AC-L1-5** Given v1 노드, When 노드를 복사하면, Then 사본에 `API_CONDITION`이 없고 응답에 제외 안내가 있다.
- **AC-L1-6** Given 존재하지 않는 `nextNodeId`/`defaultNodeId`/`failureNodeId`, When 저장하면, Then `400`과 필드별 `details`다.
- **AC-L1-7** ★ Given 노드 B를 `conditions[].nextNodeId`로 참조하는 노드 A, When B 삭제를 요청하면, Then `409 NODE_IN_USE`다(v1 참조도 동일).
- **AC-L1-8** Given 노드 B가 `API_CONDITION` 분기로만 참조됨, When 흐름 요약·설계 점검을 보면, Then B는 **고아가 아니며** 들어오는 참조 1이다.
- **AC-L1-9** Given `SCENARIO`·`SURVEY` 노드, When 실행하면, Then 동작이 No.26 이전과 같다.
- **AC-L1-10** Given API 노드가 없는 챗봇, When 기존 엔진·대화·통계·검증 테스트 스위트를 돌리면, Then **수정 없이 전부 통과**한다(FR-0-97).

### AC-L2. 연결 · 시크릿 · 권한

- **AC-L2-1** Given EDITOR, When 연결 생성·수정·삭제·테스트를 호출하면, Then 전부 `403`이고 DB 변경 0이다. `GET /api-connections/picker`는 `200`이고 `baseUrl`·`secretRef`·`authType`이 **없다**.
- **AC-L2-2** ★ Given `secretRef=ERP`, `LEGACY_API_SECRET__ERP=tok-XYZ`, When 연결 조회·목록·감사로그·`ApiCallLog`·서버 로그·시뮬레이터 응답·오류 응답을 전수 검사하면, Then `tok-XYZ`가 **0회** 나타난다.
- **AC-L2-3** Given 환경변수 미설정, When 연결 상세를 보면, Then `secretStatus: MISSING`이고 대화 호출은 `SECRET_MISSING` 실패 분기다(외부 호출 0).
- **AC-L2-4** Given 노드 3개가 참조하는 연결, When 삭제하면, Then `409 API_CONNECTION_IN_USE`와 참조 노드 목록이다. 사용 중지는 `200`이고 **다음 대화 턴부터 즉시** `CONNECTION_DISABLED`다.
- **AC-L2-5** Given `allowRawPersonalData`를 true로 바꿈, When 감사로그를 보면, Then `ApiConnection UPDATE` 1건에 before/after가 있다. 확인값 없이 요청하면 `400`이다.
- **AC-L2-6** Given 연결 테스트, When 응답이 JSON 10KB면, Then 결과에 상태·지연·바이트·`jsonParsable`만 있고 **본문이 없다**.

### AC-L3. 대화 실행 · 분기 · 치환

- **AC-L3-1** ★ Given S-1 설정과 목 서버(`data.status=SHIPPED`, `eta=09/26`), When 폼을 완료하는 메시지를 보내면, Then **한 응답에** `조회해 볼게요.` + `…09/26 도착 예정입니다.`가 있고 `pendingAnswer`가 없다.
- **AC-L3-2** Given `status=READY`, Then 조건 2 노드. `status=RETURNED`, Then `defaultNodeId` 노드. `defaultNodeId` 미지정이면 고정 불일치 문구다.
- **AC-L3-3** ★ Given 목 서버 응답 지연 5초 · 타임아웃 3초, When 호출하면, Then 3.5초 이내에 `failureNodeId` 출력이고 `ApiCallLog.outcome=TIMEOUT`이다.
- **AC-L3-4** Given 연속 실패 5회, When 6번째 턴을 보내면, Then 외부 호출 없이 **10ms 이내** 실패 분기이고 `CIRCUIT_OPEN`이다. 60초 후 다시 호출을 시도한다.
- **AC-L3-5** Given `API_CONDITION` 뒤에 `TEXT "추가 안내"`, When 실행하면, Then `추가 안내`가 **출력되지 않는다**(설계 점검 WARNING 존재).
- **AC-L3-6** Given 분기 노드도 `API_CONDITION`을 가짐, When 실행하면, Then 두 번째 호출은 **일어나지 않고**(`ApiCallLog` 1건) `API_CALL_LIMIT` 트레이스 + 실패 처리다.
- **AC-L3-7** Given 매핑 `status`가 `required`인데 응답에 없음, Then `MAPPING_MISSING` 실패 분기다.
- **AC-L3-8** Given `TEXT "{api.eta} / {주문번호} / {api.none}"`, When 치환하면, Then `09/26 / {주문번호} / `이다(비-api 토큰 유지, 없는 api 변수는 빈 문자열).
- **AC-L3-9** Given `LINK.url = "https://x/{api.link}"`, When 실행하면, Then **치환되지 않는다**.
- **AC-L3-10** Given 응답 값에 금지어 포함, When 공개 대화로 응답하면, Then 출구 필터로 **마스킹**되어 나간다.
- **AC-L3-11** Given 응답 값 `"<img src=x onerror=alert(1)>"`, When 위젯이 렌더링하면, Then 문자열이 **텍스트로** 보인다.
- **AC-L3-12** Given 이번 턴에 폼이 완료되지 않은 상태에서 버튼으로 API 노드에 도달, When SLOT 바인딩이 있으면, Then 외부 호출 0 · `BINDING_MISSING` 실패 분기다.
- **AC-L3-13** Given API 턴 완료, When 다음 턴의 요청 상태 봉투를 보면, Then 응답값·변수가 **없고** `version`은 1이다.
- **AC-L3-14** Given 고정 실패 문구로 끝난 턴, When 미응답 큐를 보면, Then **적재되지 않았다**. `ConversationLog.isAnswered=false`다.
- **AC-L3-15** Given API 분기로 끝난 턴(성공·실패 모두), When RAG 설정이 켜져 있어도, Then RAG 호출 0건이다.

### AC-L4. SSRF · 요청 구성 · 응답 제한

- **AC-L4-1** ★ Given 연결 `baseUrl`이 `http://127.0.0.1:8000`·`http://[::1]`·`http://169.254.169.254`·`http://0x7f000001`·`http://127.1`, When 호출하면, Then 전부 `BLOCKED_ADDRESS`이고 소켓 연결 0건이다. allowlist에 `127.0.0.0/8`을 넣어도 같다.
- **AC-L4-2** Given 공인 도메인이 `10.1.2.3`으로 해석, allowlist 비어 있음, Then `BLOCKED_ADDRESS`. allowlist `10.0.0.0/8`이면 성공한다.
- **AC-L4-3** ★ Given 첫 해석은 공인 IP, 두 번째 해석은 `127.0.0.1`을 주는 가짜 리졸버, When 호출하면, Then **검증된 주소로만 연결**되거나 거부된다(루프백 연결 0).
- **AC-L4-4** Given 외부가 `302 Location: http://169.254.169.254/`, Then `REDIRECT_NOT_ALLOWED`이고 두 번째 요청 0건이다.
- **AC-L4-5** Given 응답 2MB, Then 256KB 수신 시점에 중단되고 `RESPONSE_TOO_LARGE`다. `text/html` 응답은 `INVALID_RESPONSE`다.
- **AC-L4-6** ★ Given 슬롯 값 `../admin?x=1#`·`a"},"role":"admin`·`\r\nX-Evil: 1`, When GET 경로·쿼리·POST 본문에 바인딩하면, Then 서버가 받은 요청의 **경로 세그먼트 수·쿼리 키 집합·본문 키 집합·헤더 집합이 설계와 동일**하다.
- **AC-L4-7** Given 연결 허용 메서드 `GET`만, When 노드에 POST를 저장하면, Then `400`이다. PUT은 스키마에서 거부된다.
- **AC-L4-8** Given `LEGACY_API_ENABLED=false`, When API 노드 대화·연결 테스트·시뮬레이터 LIVE를 실행하면, Then 아웃바운드 소켓 0건이고 `FEATURE_DISABLED` 실패 분기다.

### AC-L5. 개인정보 · 로그 · 감사

- **AC-L5-1** ★ Given `allowRawPersonalData=false`, 전화 슬롯 `010-1234-5678`, When 호출하면, Then 외부 서버가 받은 값은 `010-****-5678`이고 `ApiCallLog.personalDataMasked=true`다. true 연결이면 원문을 받는다.
- **AC-L5-2** ★ Given 호출 100건(성공·실패 혼합), When `ApiCallLog` 전 행·서버 로그를 검사하면, Then 슬롯 값·해석된 URL·응답 본문 문자열이 **0회**다. `pathTemplate`은 `/orders/{0}` 형태다.
- **AC-L5-3** Given 시뮬레이터 목·TC·비교 실행, When `ApiCallLog`를 보면, Then 행이 **생기지 않는다**. 시뮬레이터 LIVE 1회는 `SIMULATION_LIVE` 1행이다.
- **AC-L5-4** Given 챗봇 영구삭제, When 확인하면, Then 해당 챗봇의 `ApiCallLog`가 없다.
- **AC-L5-5** Given 공개 대화 API 턴, When 감사로그를 보면, Then 호출 관련 레코드가 **0건**이다.
- **AC-L5-6** Given 저장소 전체, When `legacy-api-sealing.spec.ts`를 돌리면, Then NFR-LS6의 7단언이 모두 통과한다.

### AC-L6. 시뮬레이션 · TC

- **AC-L6-1** Given VIEWER, When `apiMode: LIVE`로 시뮬레이트하면, Then 외부 호출 0건이고 목으로 격하(또는 거부)되며 사유가 표시된다.
- **AC-L6-2** Given EDITOR · POST 연결, When LIVE로 시뮬레이트하면, Then 외부 호출 0건 · 목 격하다.
- **AC-L6-3** ★ Given EDITOR가 오버레이로 새 `API_CONDITION` 노드를 주입, When LIVE로 시뮬레이트하면, Then 외부 호출 0건이다.
- **AC-L6-4** Given `mockResponse: { failure: TIMEOUT }`, Then 실패 분기 출력과 `apiStep.outcome=TIMEOUT`(모드 `MOCK`)이다.
- **AC-L6-5** Given 시뮬레이터 LIVE 응답에 이메일 포함 변수, When `apiStep.variables`를 보면, Then 마스킹된 값이다.
- **AC-L6-6** Given API 노드를 포함한 TC 세트 2,000건, When 실행하면, Then 외부 호출 0건 · 처리량 500 TC/분 이상 · 같은 샘플이면 **두 번 실행의 응답 해시가 동일**하다.
- **AC-L6-7** Given 샘플 응답 없음, When TC가 API 노드에 도달하면, Then 실패 분기로 판정되고 결과에 `API 목 판정` 배지와 "샘플 응답 없음" 안내가 있다.

### AC-L7. 버전 · 예약 배포

- **AC-L7-1** Given 연결을 참조하는 노드를 포함한 버전 v12와 연결 삭제(노드에서 참조 제거 후), When v12 복원 미리보기를 하면, Then 경고 `API_CONNECTION_MISSING`이 있고 blocker가 아니다. 복원 후 해당 노드 실행은 실패 분기다.
- **AC-L7-2** Given 스냅샷 캡처, When 페이로드를 검사하면, Then `ApiConnection`의 필드(baseUrl·secretRef)가 **없다**.
- **AC-L7-3** Given No.26 이전에 캡처된(v1 포함) 스냅샷, When 복원하면, Then 업캐스터 없이 성공하고 v1 노드는 실행되지 않는다.
- **AC-L7-4** Given 예약 배포 실행기, When import 그래프를 검사하면, Then `LegacyApiModule` 참조 0이다.

### AC-L8. 접근성 · 콘솔

- **AC-L8-1** Given 키보드만 사용, When 연결을 등록하고 노드에 v2 조건을 설정·저장하면, Then 마우스 없이 완료된다. 목록 순서는 위/아래 버튼으로 바뀐다.
- **AC-L8-2** Given 신규 화면 3종(연결 관리 · v2 편집기 · 외부 연동 로그), When axe를 돌리면, Then 대비 위반 0건이다. 배지는 텍스트를 가진다.
- **AC-L8-3** Given 연결 테스트 실패(사설 주소), When 결과를 보면, Then 원인과 해결 방법이 함께 적힌 문구가 `aria-live`로 읽힌다.

---

## 8. 예외 케이스 (EX)

| ID | 상황 | 기대 동작 |
|---|---|---|
| EX-L-1 | 외부 **미응답**(타임아웃) | `TIMEOUT` → 실패 분기/고정 문구. 대화는 타임아웃 + 500ms 안에 끝남 |
| EX-L-2 | 외부 5xx·4xx | `HTTP_ERROR`(상태 기록) → 실패 분기. 4xx 본문은 쓰지 않음(FR-L5-7) |
| EX-L-3 | 외부 200인데 HTML/빈 본문/깨진 JSON | `INVALID_RESPONSE` → 실패 분기 |
| EX-L-4 | 응답 과대 | `RESPONSE_TOO_LARGE` → 실패 분기 |
| EX-L-5 | 리다이렉트 | `REDIRECT_NOT_ALLOWED` → 실패 분기 |
| EX-L-6 | 연결 삭제·사용 중지·시크릿 누락 | 즉시 실패 분기(외부 호출 0). 설계 점검 WARNING |
| EX-L-7 | 회로 개방 · 레이트 초과 | 대기 없이 실패 분기. 연결 목록에 `회로 열림` 텍스트 배지 |
| EX-L-8 | 필수 매핑 누락 · 배열/객체를 텍스트로 치환 | `MAPPING_MISSING` 실패 분기 / 해당 토큰 빈 문자열 + 트레이스 |
| EX-L-9 | **다국어·이모지** 슬롯 값·응답 값 | UTF-8 퍼센트 인코딩(경로·쿼리), 본문 JSON은 그대로. 길이 상한은 코드 포인트 기준. 응답의 한국어·이모지 값은 치환 가능 |
| EX-L-10 | **금지어**가 응답 값에 포함 | 출구 필터 마스킹(FR-L4-14). 사용자 입력의 금지어는 입구에서 BLOCK되어 API까지 오지 않음 |
| EX-L-11 | **세션 만료**(컨텍스트 폼 `sessionTimeoutMinutes` 초과) | 폼이 이번 턴에 완료되지 않으므로 SLOT 바인딩 API 노드는 실행되지 않음(기존 만료 안내). 관리자 세션 만료 중 연결 편집은 기존 세션 만료 모달 |
| EX-L-12 | 레거시가 **API 서버와 같은 호스트**(localhost)에 설치됨(구축형) | 루프백 절대 차단으로 호출 불가. 연결 테스트 오류 문구가 "사내 주소(사설 IP/내부 DNS)로 노출하고 허용 목록에 추가"를 안내 |
| EX-L-13 | 사설 allowlist에 절대 차단 대역 기재 | 무시 + 기동 경고 로그(FR-L5-4) |
| EX-L-14 | 외부가 느려 동시 요청 상한 도달 | 초과분 즉시 `RATE_LIMITED` 실패 분기 — 우리 서버 스레드/소켓 고갈 방지 |
| EX-L-15 | 외부 응답이 매우 깊은 중첩 JSON | 추출 깊이 10 초과 경로는 값 없음 처리. 파싱 자체는 크기 상한으로 보호 |
| EX-L-16 | 응답 키가 `__proto__`·`constructor` | 경로 문법에서 금지(저장 시 거부) · 추출 시 무시 |
| EX-L-17 | 같은 턴에 폼 완료 + 동음이의어 되묻기 | 되묻기가 먼저 반환되어 노드 매칭이 없으므로 API 호출 없음(기존 `resolver.ts` 262~274행 흐름). 되묻기 해소 후 노드는 폼 완료 턴이 아니므로 SLOT 바인딩 누락 → 설계 점검 FR-L3-3이 사전 경고 |
| EX-L-18 | 다중 인스턴스 | 회로·레이트는 인스턴스별(정확한 전역 한도 아님 — 수용). 시크릿·allowlist는 모든 인스턴스에 동일 설정 필요(운영 문서) |
| EX-L-19 | 시크릿 교체 | 환경변수 변경 + 재기동. 교체 중 잠깐의 인증 실패는 `HTTP_ERROR(401)` 실패 분기(무중단 교체는 범위 밖) |
| EX-L-20 | v1 노드 편집 중 저장 | `400 API_OUTPUT_LEGACY_FORMAT` + "전환 후 저장" 안내(S-7) |
| EX-L-21 | 목 샘플 JSON 형식 오류 | 저장 시 400(JSON 파싱·16KB) |
| EX-L-22 | **익명 사용자가 타인 번호로 조회** 반복 | 연결 레이트리밋(개인정보 조회형 30/분) + 공개 레이트리밋. 근본 차단은 레거시 쪽 2요소 대조(J-19, 위험 수용 P-14) |
| EX-L-23 | 외부 응답이 매우 느리게 조금씩 옴(slow-loris형) | 타임아웃은 **전체 수신 합산**이므로 상한 안에서 중단 |
| EX-L-24 | 응답 치환 후 TEXT 1000자 초과 | 절단(FR-L4-7) |
| EX-L-25 | IPv6 전용 환경 | 동일 규칙(IPv6 대역 포함). allowlist도 IPv6 CIDR 허용 |

---

## 9. Out of scope (이번에 하지 않는 것과 재검토 트리거)

| 항목 | 기각/연기 사유 | 재검토 트리거 |
|---|---|---|
| **`SCENARIO` 실행 · 표준 커넥터 템플릿**(ERP/CRM/결제) | J-1 — 사전 정의 거래의 저장소·계약 없음 | ⚠ P-1에서 "포함" 선택 시, 또는 No.39 착수 |
| **시크릿 DB 암호화 저장 · 콘솔 입력 · 키 회전 · 외부 비밀 관리자(Vault 등)** | J-3 — 새 키 관리 문제 | ⚠ P-3 · 구독형 셀프서비스 요구 · No.45 필드 암호화 |
| **PUT/PATCH/DELETE · 재시도 · 멱등키 · 비동기 콜백 · 재시도 큐** | J-7 · FR-L5-9 | 쓰기형 연동 요구 → No.41 |
| **비동기 전달(PENDING/폴링)** | J-5 — 분기 후 상태 확정 불가 | 레거시 P95가 상시 3초 초과 · 사용자 이탈 보고 |
| **응답값의 다음 턴 보존 · 세션 변수 저장소 · 서명 상태** | J-9 · ADR-0009 | 다단계 거래(조회 → 선택 → 확정) 요구 시 서버 세션 저장소와 함께 |
| **4xx 응답 본문으로 분기**(예: 404 = 주문 없음) | FR-L5-7 — 1차 단순화 | 관리자 요청 누적 시 "상태 코드 조건" 연산자 추가 |
| **XML/SOAP/폼 인코딩/파일 응답 · mTLS 클라이언트 인증서 · OAuth2 토큰 발급 흐름** | 파서·자격증명 유형 확대 | 구축형 고객 레거시 조사 결과 |
| **최종 사용자 인증(본인확인) 연동** | J-19 — 별도 인증 체계 | 금융/공공 고객 요구(No.36/45) |
| **챗봇별 연결 사용 허용 목록 · 연결 권한 세분화** | FR-L2-6 — 멀티테넌시 없음 | 그룹별 접근 제한 도입 시 |
| **요청/응답 본문 디버그 로그(마스킹·단기 보존)** | J-13 — 원문 저장 0 원칙 | 연동 장애 분석 요구가 반복될 때(TTL·마스킹·권한과 함께) |
| **`ApiCallLog`·`RagCallLog` 보존기간 자동 정리** **[2026-09-26 No.45 설계 완료 — `CALL_LOGS` 전역 보존기간 경과 행 삭제(파기 잡 · ADR-0040)]** | 행이 작음 · No.45 소관 | 행 수 1,000만 · No.45 착수(ADR-0032 `PollingLoop` 재사용 가능) |
| **`RagHttpClient`의 리다이렉트·응답 크기 보강** | 이 그룹 범위 밖(고정 서버) | 코드리뷰 또는 RAG 서버 이전 시 — 제안만(§10) |
| **전역 정확 레이트리밋(다중 인스턴스 공유 카운터)** | 인스턴스 로컬 수용 | 구독형 다중 인스턴스 운영 시 |
| **URL 필드 치환 · 이미지 동적 표시** | J-10 — 피싱 위험 | 도메인 allowlist 기반 링크 검증 설계 시 |

---

## 10. 상위 문서 갱신 제안 (이 문서에서는 수정하지 않음)

> 설계 변경은 `system-architect` 경유 원칙(CLAUDE.md)에 따라 **제안만** 기록한다.

| 문서 | 위치 | 제안 내용 |
|---|---|---|
| `docs/01-requirements/기능요구사항.md` | §3 No.26 행(63행) | GPU **1 유지**. 설명 보강: "대화 노드의 API 조건에 **관리자가 등록한 연결**로 GET/POST 호출 → 응답 경로 값으로 **같은 턴 분기·출력 치환**(시크릿은 서버 환경변수 · SSRF 다층 방어 · 호출 메타데이터 로그)". 비고: "`SCENARIO`·표준 커넥터는 No.39, 쓰기형 후속 액션은 No.41, 시크릿 DB 암호화·로그 보존은 No.45" · 구독형 비고 "고객 레거시 HTTPS 도달 + 고정 송신 IP 필요" |
| 〃 | §2 No.5 행(37행) · §3 No.39(81행) | No.5 비고의 "3종은 정의·저장까지만" → "`SCENARIO`/`SURVEY` 2종" · No.39 비고에 "No.26의 `ApiConnection`을 커넥터 인스턴스로 확장" |
| `docs/02-spec/개발명세서.md` | §3 174·198행 | `ApiCallLog` **실체화**(§5.2 — 메타데이터 전용) · `ApiConnection` 행 추가 · "미도입 결정 ⑤" 문구를 "No.26에서 도입(원문 컬럼 없음)" 각주로 |
| 〃 | §4 | 연결 7개 · 호출 로그 2개 핸들러 · 시뮬레이터 확장 · `@Public()` 6개 유지 · 레거시 프록시 경로 없음 |
| 〃 | §5 성능 | "API 노드 없는 턴 예산 불변 · API 턴 = 기존 + 외부 응답(상한 = 연결 타임아웃 기본 3초/최대 10초) + 50ms · 턴당 외부 호출 1회" |
| 〃 | §5 보안 | ① "채널 자격증명은 저장하지 않는다 … 연동 착수 시점에 결정" → **"레거시 연동 시크릿은 DB에 저장하지 않고 환경변수 참조(`secretRef`)로만 주입한다(ADR-0034)"** 로 결정 기록 ② PII 적용 지점 3곳 → **4곳**(레거시 송신 — 연결 단위 원문 예외 가능) ③ 외부 HTTP 출구 3곳 → **4곳**(`LegacyApiHttpClient`) + SSRF 규약(절대 차단 대역 · 사설 allowlist · 리다이렉트 불허 · 256KB) ④ 사용자 입력 URL 규약에 "호스트는 등록 연결만" 추가 |
| 〃 | §5 확장성 | 연결 단위 회로·레이트·동시성 = 인스턴스 로컬, 교체 지점 1곳 |
| 〃 | §6 결정(신규) | J-2/J-3/J-4/J-5/J-9/J-11/J-12/J-15/J-16 |
| `docs/02-spec/decisions/` | **ADR-0034(신규)** | "레거시 API 연동 = 연결 레지스트리 + 환경변수 시크릿 + 엔진 정지점/재진입 + 동기 단발 호출 + SSRF 다층 방어 + 메타데이터 로그" |
| `ADR-0008` | 50행 · 보론 | "상수에서 빼는 것만으로 열린다" → **"`API_CONDITION`은 형태(v2)로 실행 가능 여부를 판정한다. v1은 미지원 유지"** 보론. UI 배지의 상수 미사용 결함 기록 |
| `ADR-0013` | 적용 지점 | 4번째 지점(레거시 송신) + 연결 단위 원문 송신 예외(ADMIN 승인·감사) |
| `ADR-0016` | §5 | "No.26에서 `ApiCallLog` 도입 — **원문 미저장**으로 보존·마스킹 충돌을 원천 제거" 갱신 각주 · `ApiConnection` 대상 추가 |
| `ADR-0022` | 결과 · 재검토 | "외부 출구 봉인 형식을 No.26이 계승" 참고 각주 · ⚠ `RagHttpClient`에 리다이렉트 불허·응답 크기 상한 보강 **검토 제안**(이 그룹 범위 밖) |
| `ADR-0029`/`ADR-0030` | TC 격리 · 해시 | TC·비교는 레거시를 **목으로만** 판정 · No.26 전후 실행 해시 불연속 안내 |
| `ADR-0031` | §1 스냅샷 대상 | `ApiConnection`은 스냅샷 밖(전역 설정) · 참조 끊김 = 경고 |
| `ADR-0015` | 권한 표 | 신규 0종 · 연결 관리 = `security:*` 각주 |
| `docs/requirements/dialogue-design.md` | NFR-S4/S5(418~419행) · FR-5-14 ⑫ · FR-5-16 ⑧ | "No.26에서 해소 — 인라인 URL/헤더 폐기(v2), SSRF는 다층 방어로 재정의" 각주 · 설계 점검 항목 추가(FR-L3-4) |
| `docs/03-design/dialogue-design-ui-spec.md` | 197행 · 973행 | `UnsupportedOutputBadge` 대상 축소 · 헤더 마스킹 스펙 **폐기**(v2에 헤더 입력 없음) |
| `docs/03-design/UIUX_준수기준.md` | — | 필요 시 "외부 시스템 오류 안내 문구 원칙(내부 용어 금지·대안 제시)" 추가 |
| `docs/04-test/시험항목.md`·`시험데이터.md`·`자동시험_전략.md` | — | AC-L1~L8 · **가짜 레거시 서버 픽스처**(지연·3xx·과대 응답·HTML·5xx) · **가짜 DNS 리졸버**(재바인딩) · SSRF 입력 표 · 시크릿 누출 grep 시험 |

---

## 11. PM 확인이 필요한 항목

> **PM 결정: 권고안 채택(2026-09-24)** — P-1~P-15 전부 아래 표의 "권고안" 열로 확정했다.
>
> | # | PM 결정(2026-09-24) |
> |---|---|
> | P-1 | **`API_CONDITION`만 실행.** `SCENARIO`는 미지원 유지 → No.39 |
> | P-2 | **ADMIN 관리 전역 `ApiConnection` 레지스트리 도입.** 노드는 `connectionId` + 상대 경로만(URL·헤더 제거) |
> | P-3 | **(a) 환경변수 참조** — 시크릿은 DB에 저장하지 않고 `secretRef` + 환경변수 `LEGACY_API_SECRET__<REF>` |
> | P-4 | **v1: 읽기 가능 · 실행 안 함 · 신규 v1 저장 400 · 편집 시 v2 전환 필요 · 조회 응답에서 헤더 값 가림**(VIEWER가 `dialogue:read`로 평문 토큰을 읽던 노출 해소) · 자동 변환·삭제 없음 |
> | P-5 | **같은 응답 내 동기 호출** · 연결별 타임아웃 기본 3초(1~10초) · 턴당 1회 · 재시도 없음 · 회로차단 5회 실패/60초 · API 노드 없는 턴의 기존 성능 예산 불변 |
> | P-6 | **GET/POST만** |
> | P-7 | **`defaultNodeId`/`failureNodeId` 선택, 미지정 시 고정 문구**, `API_CONDITION`은 노드의 마지막 아웃풋(뒤는 실행 안 함). 고정 문구 턴은 `isAnswered=false`·미응답 큐 미적재 |
> | P-8 | **`{api.이름}`은 같은 턴·텍스트 필드만 치환**, URL 필드 치환 금지, 다음 턴 이월 없음 |
> | P-9 | **루프백/링크로컬/메타데이터 절대 차단**, 사설 대역은 환경변수 allowlist로만(기본 빈 목록), DNS 해석 후 실제 접속 IP 검사, 리다이렉트 불추종, 응답 256KB·JSON만. 기존 NFR-S4 재정의 |
> | P-10 | **기본 마스킹 송신**, 연결별 `allowRawPersonalData`(ADMIN·확인값·감사로그), 로그에는 원문 절대 없음 |
> | P-11 | **`ApiCallLog` 메타데이터만**(`RagCallLog` 선례), 목/TC 미기록, 자동 보존정리 없음(No.45) |
> | P-12 | **신규 권한 없음** — 연결 관리 `security:write`, 선택 목록 `dialogue:read`, 호출 로그 `chatbot:read`, 시뮬레이터 실호출 `simulation:write` |
> | P-13 | **시뮬레이션·TC 기본 목**(연결의 샘플 응답). 실호출은 `simulation:write` + GET + 저장된 노드 + 시뮬레이터 단건만 |
> | P-14 | **익명 조회 위험 수용·가시화** — `personalDataLookup` 표시, 편집기 경고, 기본 레이트리밋 30/분 |
> | P-15 | **GPU 1 유지** · 구축형 ○ · 구독형 ○(전제조건 명시) |
> | (architect) | 엔진 연결 방식(J-4 — 정지점 → 엔진 밖 실행 → 순수 재진입, 엔진 수정 범위 FR-0-96 닫힌 목록 + 엔진 I/O 0건 정적 검사) · 참조 무결성 편입(J-17 — `conditions[].nextNodeId`가 4곳 참조 검사에서 누락된 기존 결함 해소) · 스냅샷 취급(J-18 — 연결은 스냅샷 밖, 시크릿 미포함) |

| # | 항목 | 왜 PM이 정해야 하는가 · 근거 | 권고안 |
|---|---|---|---|
| **P-1** | **범위: `SCENARIO`(기간계 연동) 실행을 포함하는가**(J-1) | `dialogue-design.md` 281행이 `SCENARIO` 실행을 No.26에 배정했으나, `{scenarioKey, params}`(`dialogue.ts` 502~505행)가 가리킬 거래 정의 저장소가 없다. 포함하면 커넥터 정의 모델이 필요해 범위가 No.39 수준으로 커진다 | **`API_CONDITION`만.** `SCENARIO`는 미지원 유지 → No.39. 이 그룹의 연결 레지스트리가 그 토대 |
| **P-2** | ★ **연결 레지스트리 도입(노드에서 URL·헤더 제거) + 전역 범위**(J-2) | 현재 URL·토큰이 노드 JSON에 있어 VIEWER 조회(`dialog-nodes.controller.ts` 57~58행 · `security.ts` 48행)·노드 복사·버전 스냅샷·시뮬레이션 오버레이로 퍼진다. 편집 경험이 "URL 직접 입력"에서 "연결 선택"으로 바뀐다(원본 ROCHA 화면과 다를 수 있음 — 조사 한계) | **도입.** 연결은 ADMIN이 전역으로 등록, 노드는 `connectionId` + 상대 경로만 |
| **P-3** | ★ **시크릿 저장 방식**(J-3 · T-5) — (a) 환경변수 참조 (b) DB 암호화(마스터 키 = 환경변수) (c) 외부 비밀 관리자 | 개발명세서 288행이 "연동 착수 시점에 먼저 결정"을 요구. (a)는 선례(291행 ⑤, `env.validation.ts` 67행)와 같고 키 관리가 없지만 **시크릿 추가에 운영자 작업·재기동**이 필요하다. (b)는 셀프서비스지만 키 회전·백업 유출·암호화 구현이 새로 생긴다 | **(a) 환경변수 참조(`LEGACY_API_SECRET__<REF>`).** DB·API·로그에 값 0. (b)는 No.45 필드 암호화와 함께 재검토 |
| **P-4** | **기존 v1 저장 데이터 처리**(J-16) | 자동 변환은 ADMIN 승인 없이 송신 경계를 넓히고, 자동 삭제는 자산 쓰기 봉인(ADR-0025 S-1)과 스냅샷 해시(ADR-0031)를 깬다. 잔존 건수는 시드 기준 0(`seed.ts` 497~498행)이나 실제 DB는 미계측 | **읽기 호환 · 실행 안 함 · 쓰기 거부 · 편집 시 전환 강제 · 조회 응답에서 헤더 값 가림.** 자동 변환·스크럽 없음. 스냅샷 속 토큰은 버전 삭제로 제거 |
| **P-5** | **호출 방식 · 성능 예산**(J-5) | 공개 대화 500ms P95(개발명세서 279행)를 API 턴에 적용할 수 없다. PENDING(ADR-0023)은 분기 후 상태 확정 문제로 부적합(`public-conversation.service.ts` 276~277행) | **동기 · 연결별 타임아웃 기본 3초(1~10초) · 턴당 1회 · 재시도 0 · 회로차단 5회/60초.** API 없는 턴 예산 불변 |
| **P-6** | **허용 메서드**(J-7) | 현재 스키마는 5종(`dialogue.ts` 525행), 카탈로그는 GET/POST. 익명 채팅발 원격 수정·삭제는 위험 등급이 다르다 | **GET · POST만.** POST는 재시도 없음 · 시뮬레이터 실제 호출 불가 |
| **P-7** | **실패·불일치 시 사용자 경험**(J-6) | 현재 스키마에 실패/불일치 분기가 없다. 고정 문구만 둘지, 분기 노드를 허용할지, 미응답 통계에 어떻게 잡을지 | **선택 `defaultNodeId`·`failureNodeId` + 없으면 고정 문구.** `API_CONDITION` 뒤 아웃풋은 실행 안 함. 실패 문구 턴은 `isAnswered=false`이되 **미응답 큐 미적재** |
| **P-8** | **응답값의 사용 범위**(J-9 · J-10) | 대화 상태는 클라이언트 보관·무서명(ADR-0009 1·70행)이라 응답값을 다음 턴으로 넘기면 노출·조작된다. 일반 텍스트 치환을 켜면 기존 `{...}` 문자열 답변이 깨진다(`context-session.ts` 137행 문법) | **같은 턴의 분기·출력 치환만.** `{api.이름}` 토큰만 · 텍스트 필드만 · URL 필드 치환 금지 · 다음 턴 보존 안 함 |
| **P-9** | ★ **사내망 접근 정책(SSRF)**(J-11) | NFR-S4(`dialogue-design.md` 418행)의 "사설 대역 차단"은 구축형 사내 레거시 접근과 정면 충돌한다. 루프백에는 ml-worker·임베딩 서버가 있다 | **루프백·링크로컬·메타데이터 = 절대 차단(설정 불가)** · **사설 대역 = 운영자 환경변수 allowlist로만 허용**(기본 빈 값) · DNS 해석 후 IP 검증 · 리다이렉트 불허 · 응답 256KB · JSON만 |
| **P-10** | ★ **개인정보 외부 송신**(J-12) | ADR-0013·개발명세서 288·291행은 외부 송신 전 마스킹이 원칙이나, 레거시 조회는 전화번호·주문번호 원문이 있어야 동작한다(`maskPii` — `pii-mask/src/index.ts` 66행 — 는 전화번호를 부분 마스킹한다) | **기본 마스킹 · 연결 단위 `allowRawPersonalData`(ADMIN·확인값·감사)로만 원문 송신** · 로그·트레이스에는 항상 원문 0 |
| **P-11** | **`ApiCallLog` 범위와 보존**(J-13 · T-4) | ADR-0016 §5(92~94행)는 "Header에 토큰/PII 포함 가능, 고용량"을 전제했다. 원문을 저장하면 마스킹·보존 정책이 먼저 필요하다. 자동 정리 배치는 아직 없다(`RagCallLog`도 없음 — schema.prisma 482~507행) | **메타데이터만(원문 0) · 경로 템플릿만 · 목·TC 미기록 · 자동 정리 1차 없음(No.45)** |
| **P-12** | **권한 배치**(J-14) | "어디로 나갈 수 있는가"는 송신 경계다. 신설 시 16종이 되고 역할 매핑 결정이 필요하다(`security.ts` 20~42행) | **신규 0종.** 연결 관리·테스트 = `security:write`(ADMIN) · 선택 목록 = `dialogue:read` · 호출 로그 = `chatbot:read` · 시뮬레이터 실제 호출 = `simulation:write` |
| **P-13** | ★ **시뮬레이션·TC에서 실제 호출 여부**(J-15 · T-7) | 시뮬레이터는 VIEWER(`simulation:read`, `simulation.controller.ts` 21행)가 쓰고 오버레이(`conversation.ts` 50~51행)로 임의 노드를 주입할 수 있다. TC는 운영 자원 격리·결정론이 원칙이다(ADR-0030) | **기본 목(연결 샘플 응답).** 시뮬레이터 실제 호출은 `simulation:write` + GET + 저장된 노드 + 단건만. 비교·TC는 항상 목. 목·TC는 `ApiCallLog` 미기록 |
| **P-14** | **익명 사용자의 개인정보 조회형 연동 위험 수용**(J-19) | 위젯 사용자는 인증되지 않아 타인 번호로 조회가 가능하다. 우리 쪽에서 근본 차단할 수 없다(레거시 설계 문제) | **수용 + 표시**: 연결 `personalDataLookup` 표시 · 편집기/설계 점검 경고 · 기본 레이트리밋 30/분 · 레거시 2요소 대조 안내. 최종 사용자 인증은 범위 밖 |
| **P-15** | **GPU · 배포 형태 확인**(J-20) | 카탈로그 GPU 1 · 구축형 ○ 구독형 ○. 구독형은 고객 레거시 HTTPS 노출과 고정 송신 IP라는 **인프라 전제**가 생긴다 | **GPU 1 유지 · 구축형 ○ · 구독형 ○(전제조건 명시)** |

> **쟁점 → P 매핑**: 범위 = P-1 · 시크릿/데이터 = P-2·P-3·P-4 · 엔진/성능 = P-5·P-7·P-8 · 보안 = P-6·P-9·P-10·P-14 · 로그/감사 = P-11 · 권한 = P-12 · 품질 도구 = P-13 · 카탈로그 = P-15. **엔진 정지점/재진입 방식(J-4)·참조 무결성 편입(J-17)·스냅샷 취급(J-18)은 architect 확정 사항**(PM 확인 불요 — 권고안 제시).

---

## 12. 다음 단계 인계

| 에이전트 | 이 문서에서 넘기는 것 |
|---|---|
| **`system-architect`** | ① **ADR-0034** 작성(J-2/J-3/J-4/J-5/J-9/J-11/J-12/J-15/J-16) ② **엔진 정지점/재진입 계약**(`apiCall` 결과 형태 · 재진입 함수 시그니처 · 폴백 결과 동봉 여부 FR-L4-9 · 4 소비자 공용 헬퍼 NFR-LM4) ③ `API_CONDITION` **읽기/쓰기 스키마 분리** 방식과 v1/v2 판별 필드 ④ **DNS 검증 후 고정 주소 연결** 구현 방식(Node `fetch`/`undici` 커스텀 lookup 등) · 응답 스트림 상한 ⑤ 연결 캐시 정책(사용 중지 즉시 반영) ⑥ `getOutgoingNodeRefs` 확장이 흐름 요약·고아 판정·스냅샷 경고에 주는 영향 ⑦ 미응답 수집 판정 사유 추가(FR-L4-13, ADR-0019) ⑧ `legacy-api-sealing.spec.ts` 7단언 ⑨ 스냅샷 정규화 안정성(FR-L8-1) ⑩ ADR-0008/0013/0016/0022/0029/0030/0031/0015 갱신 각주 |
| **`ui-designer`** | ① 보안 설정 > API 연결(목록·생성/수정·테스트·샘플 응답·삭제 409) ② **노드 편집기 v2 폼**(연결 선택 · 경로/쿼리/본문 바인딩 선택기 · 응답 매핑 · 조건 · 기본/실패 분기 · 샘플 미리보기) ③ v1 표시·전환 대화상자 ④ 시뮬레이터 `외부 API` 단계 패널·목 선택·실제 호출 토글 ⑤ 챗봇 상세 `외부 연동 로그` 탭 ⑥ 고정 안내 문구 검토(FR-L4-8) ⑦ 위젯 전송 중 표시의 보조기술 알림 확인(NFR-LA4) |
| **`backend-implementer`** | FR-L1~L8 전부. ★ **최우선 주의 6가지**: ① **시크릿 0 누출**(AC-L2-2) ② **SSRF 절대 차단 + 재바인딩**(AC-L4-1·L4-3) ③ **요청 구조 인젝션 불가**(AC-L4-6) ④ **API 없는 번들 바이트 동일**(AC-L1-2·L1-10) ⑤ `ApiCallLog` 원문 0(AC-L5-2) ⑥ 엔진 I/O 심볼 0 · TC/비교/버전/예약 모듈의 레거시 모듈 import 0 |
| **`frontend-implementer`** | FR-L9-\*. 미지원 배지를 **공유 판정 함수**로 교체(`DialogOutputEditor.tsx` 126행 하드코딩 제거) · 헤더 입력 UI 제거 · 샘플 미리보기는 엔진 공유 순수 함수 재사용 |
| **`test-automation`** | AC-L1~L8. ★ **필수 8종**: **AC-L1-2**(v1 무호출·바이트 동일) · **AC-L1-4**(VIEWER 토큰 미노출) · **AC-L1-7**(분기 참조 노드 삭제 409) · **AC-L2-2**(시크릿 전수 grep) · **AC-L3-3**(타임아웃 실패 분기) · **AC-L4-1/L4-3**(SSRF·재바인딩) · **AC-L4-6**(인젝션) · **AC-L6-3**(오버레이 LIVE 차단). 실제 외부 네트워크 호출 테스트 0(가짜 서버·가짜 리졸버) |
| **`ml-engineer`** | 해당 없음(신규 모델 0 · ml-worker 호출 0). 참고: 루프백 절대 차단으로 **레거시 연결이 ml-worker를 호출할 수 없음**이 보장된다 |
