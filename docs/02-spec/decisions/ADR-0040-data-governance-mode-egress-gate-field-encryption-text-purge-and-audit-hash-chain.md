# ADR-0040 — 데이터 거버넌스 = 서버 단위 모드 · 출구 레지스트리 게이트 · 필드 AES-256-GCM 봉투 · 텍스트 소거형 보존 · 감사 해시 체인

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-26
- **결정자**: system-architect (도입·범위·정책 12건은 PM 확정 — 요구사항 §11 P-1~P-12 전부 추천안, 2026-09-26)
- **관련**: `docs/requirements/data-governance.md` J-1~J-20, FR-0-161~171, FR-DG1-\*~FR-DG9-\*, NFR-DGP/DGS/DGA/DGM, AC-DG1~DG8, EX-DG-1~24, C-1~C-9 / ADR-0002(영구삭제) · ADR-0013(PII 마스킹) · ADR-0015(권한) · ADR-0016(감사) · ADR-0022/0034(외부 출구 봉인) · ADR-0026(증강 3포트) · ADR-0032(`PollingLoop`·임대) · ADR-0033(로그 봉인·롤업 규약) · ADR-0036(상담 원문)
- **Supersedes(부분)**: **ADR-0016 대안표**의 "조회(READ) 이력도 기록 — 기각"(→ 모드 ON의 **닫힌 목록 열람 감사**로 부분 대체)과 "보존기간 정책·아카이브 배치를 지금 도입 — 기각"(→ 이 ADR이 도입) · **ADR-0033 §2 L3**의 "로그 `update*` 0건"(→ **텍스트 소거 서비스 1파일 예외**). ADR-0016의 나머지(명시 호출·커밋 후 기록·화이트리스트·실패 흡수)와 ADR-0033 §3의 **삭제 경로 규약(단일 서비스 + 롤업 선적재 · `LOG_DELETION_ALLOWLIST` 빈 배열)** 은 **불변**이다 — 이 ADR은 행을 지우지 않는다.
- **영향 범위**: `apps/api/prisma/schema.prisma`(+ 마이그레이션 1) · `apps/api/src/{governance(신규), common/{governance,egress,crypto}(신규), audit-logs, handoff, survey-responses, stats, learning, validation, embedding, rag, augmentation, legacy-api, api-connections, chatbots, config}` · `packages/shared-types/src/{governance(신규), audit, legacy-api, common, handoff, survey, learning, index}.ts` · `packages/pii-mask` · `apps/web`. **`packages/dialogue-engine`·`apps/widget`·`apps/ml-worker` 변경 0**
- **세부 설계**: `docs/02-spec/data-governance-설계.md`

## 맥락

카탈로그 No.45는 "데이터 저장 위치 제한, 필드 단위 암호화, 감사로그 보존기간 정책화 등 금융/공공 규제 대응 **옵션**"이다. 선행 17개 그룹이 보존기간(대화로그·설문·상담·호출 로그·감사로그 — 전부 무기한), 감사 무결성, 열람·내보내기 감사, 필드 암호화, 레지던시를 이 번호로 넘겼다. 코드 확인 결과 결정할 것은 일곱 가지다.

1. 레지던시를 애플리케이션이 **증명할 수 있는** 형태는 무엇인가(SQLite 단일 파일 · 외부 HTTP 출구 5클래스).
2. 거버넌스 정책을 **DI 밖 클래스를 포함한** 출구·복호화 지점에 어떻게 전달하되, 기본값에서 동작을 바꾸지 않는가.
3. 필드 암호화의 계층·대상·형식·키 교체는 무엇인가(SQLite + Prisma = DB 계층 암호화 불가 · 질문 순위 `groupBy`·미응답 큐 유일 키가 무작위 암호문과 충돌).
4. 보존기간이 지난 대화 원천을 **통계와 로그 봉인을 깨지 않고** 어떻게 파기하는가(ADR-0033 §3은 행 삭제 시 같은 트랜잭션 롤업 선적재를 의무화).
5. 감사로그 변조를 어떻게 탐지하며, 다중 인스턴스·Postgres 전환에서도 순번이 정확한가.
6. 열람 감사를 무엇에, 어떤 단위로, 어떤 기계로 남기는가(ADR-0016은 인터셉터와 조회 감사를 기각했다).
7. 누가 무엇을 바꿀 수 있는가(권한 · 완화 방향 통제).

## 결정

### 1. 거버넌스 모드 = 서버 단위 스위치 · 거버넌스 런타임 = 부트스트랩 1곳이 1회 설치하는 프로세스 전역 불변 상태

- `DATA_GOVERNANCE_MODE=OFF|ON`(기본 OFF). 모드는 출구 집행·열람 감사·필드 암호화의 전제이며, 보존 정책과 감사 체인은 모드와 무관하다.
- `GovernanceBootstrapService.onModuleInit` **1곳**이 기동 검증(저장 경로·출구 호스트·키링·옛 키 필요 행) 후 `installGovernanceRuntime({ mode, egress, encryptionEnabled })`·`configurePiiMaskMode()`를 1회 호출한다. 실패는 예외 = 기동 실패.
- 출구 가드·`sealField`/`openField`·열람 감사 판정은 이 상태를 **읽기만** 한다. **미설치 기본값 = 현행 동작**(출구 통과·평문 그대로·열람 기록 없음·PARTIAL)이라 AppModule을 띄우지 않는 단위 시험과 기존 spec이 무수정 통과한다.
- 키 바이트는 이 상태에 넣지 않는다 — `env-key.provider.ts` 1파일이 `DATA_ENCRYPTION_KEYS`·`AUDIT_CHAIN_KEY`를 `process.env`에서 지연 1회 파싱해 모듈 스코프에만 두고 봉인·개봉·서명 함수만 export한다. 두 키는 zod 스키마에 넣지 않는다(`ConfigService`에 실리지 않게 — `LEGACY_API_SECRET__` 선례).

### 2. 레지던시 = 저장 경로 기동 검증 + 출구 레지스트리 게이트 + 데이터 지도 (P-1 (d))

- **저장**: 모드 ON에서 `DATABASE_URL`의 SQLite 절대 경로(심볼릭 링크 해석 · 상대 경로 거부)가 `DATA_RESIDENCY_ALLOWED_DIRS` 하위인지, 원격 DB면 호스트가 `DATA_RESIDENCY_ALLOWED_DB_HOSTS`인지 기동 시 검사.
- **전송**: 외부 HTTP 출구 5클래스(`EMBEDDING`·`RAG`·`AUGMENT_GEMINI`·`AUGMENT_LOCAL`·`LEGACY_API`)를 **코드 상수 레지스트리 1곳**에 파일·설정·송신 데이터·마스킹 여부와 함께 등록하고, 각 출구 파일이 송신 직전 `assertEgressAllowed()`/`checkEgress()`를 부른다. 허용 목록 `DATA_EGRESS_ALLOWED_HOSTS`(정확 일치 · 선행 `*.` 접미 일치 · 선택 포트 · **루프백 자동 허용 없음**).
- 환경변수로 정해지는 4클래스는 **기동 검사**가 막고(목록 밖 = 기동 실패), DB로 정해지는 레거시는 **저장 시 `400 EGRESS_HOST_NOT_ALLOWED` + 호출 시 DNS 전 차단 → `ApiCallOutcome.EGRESS_BLOCKED`**. 호스트 허용은 ADR-0034의 주소 검사를 **대체하지 않고 더한다**.
- 차단은 각 출구의 **기존 실패 분기**로 흐른다(임베딩 저하·RAG 실패·G1 폴백·레거시 실패 분기) — 새 실패 모드 없음.
- 임베딩 출구가 공개 질의를 **마스킹 없이** 보내는 현황은 숨기지 않는다: 레지스트리 `QUERY_RAW`로 분류, 모드 ON에서 호스트 승인 필수, 루프백이 아니면 데이터 지도·기동 로그 경고. 질의 마스킹은 하지 않는다(의미 매칭 품질).
- 물리 리전·백업 위치·디스크 암호화·모델 오프라인(`HF_HUB_OFFLINE`)은 운영 문서 책임이며, 데이터 지도는 디스크 암호화를 **운영자 자기 신고값**으로만 보여 준다.

### 3. 필드 암호화 = 애플리케이션 AES-256-GCM 봉투 · 1차 3필드 · 환경변수 키링 · 커서 재암호화 (P-2 (b) · P-7 · P-8)

- 계층: 인프라(디스크 암호화) = 운영 전제, **애플리케이션 필드 암호화 = 1차**, DB 계층(SQLCipher·TDE) = 범위 밖(Prisma SQLite 엔진 미지원).
- 대상(코드 상수 1곳): **`HandoffMessage.rawText` · `HandoffMessage.text` · `SurveyAnswer.textValue`** — DB 수준 조회 의존 0. 대화로그·미응답 큐 본문은 2차(HMAC 블라인드 인덱스 동반).
- 형식: **`enc:v1:<keyId>:<base64(iv‖ciphertext‖tag)>`**(버전 태그 · 키 id · 96비트 무작위 IV · 128비트 태그). **AAD = `테이블:컬럼:행 id`** — 행 id는 쓰기 파일이 앱에서 선발급. 접두 없음 = 평문(이행 기간 겸용 읽기).
- 순서: 금지어 → PII 마스킹 → **암호화**(저장 직전 마지막). 쓰기 주체는 **기존 쓰기 파일 그대로**(`handoff-thread.service.ts`·`survey-response.service.ts`) + 재암호화용 writer 1파일. 개봉은 읽기 서비스 6파일 — 실패는 `"[복호화 실패]"` + 경고(요청은 성공). 상담 원문은 **표시 판정을 통과한 행만** 개봉한다.
- 키링 = `DATA_ENCRYPTION_KEYS`(첫 키 = 쓰기). 교체 = 새 키를 앞에 추가 → 재암호화 잡(필드별 id 커서 · 행 단위 CAS · `secure_delete` · 임대 선점) → 옛 키 행 0 → 제거. **옛 키가 필요한 행이 남았는데 키를 빼면 기동 실패**(기동 1회 접두 검색). `KeyProvider` 인터페이스 1개가 KMS(2차) 교체 지점이다.
- 끄기 = 환경변수만(신규 쓰기 평문 · 기존 암호문은 키로 계속 읽음). 콘솔 컨트롤 없음.

### 4. 보존 = 전역 + 챗봇 재정의 · 대화 원천은 **텍스트만 소거**(행·수치 보존) · 호출/감사 로그는 행 삭제 (P-3 (a) · P-5)

- 대상 6종: `CONVERSATION_TEXT`·`UNANSWERED_CLOSED`·`SURVEY_FREE_TEXT`·`HANDOFF_TEXT`(챗봇 재정의 가능) · `CALL_LOGS`·`AUDIT_LOGS`(전역만). 값 = 일수 | 무기한. 기본 = 전부 무기한. 서버 하한 대화 7일·감사 365일·상한 3650일(환경변수 — **완화는 환경변수로만**).
- 단축은 유예(기본 7일) 후 적용 · 영향 미리보기 · 확인 문자열(`"보존기간 단축"` 또는 챗봇 이름) · 감사. 연장은 즉시.
- **대화 원천 4종은 행을 지우지 않는다** — 텍스트 컬럼을 `""`로(미응답 큐 정규화 키는 행마다 다른 `#PURGED#<id>` — 유일 키 보존) 바꾸고 `textPurgedAt`을 채운다. 행·버킷·`sessionId`·`groupId`·매칭 id·설문 선택/척도·상담 수치는 그대로라 **모든 수치 통계가 바이트 단위로 불변**이고 롤업 테이블이 필요 없다. 질문 순위만 공유 필터 상수로 소거 행을 제외한다.
- 쓰기 주체 = **`governance/writer/governance-data.writer.ts` 1파일**(미export · 파기 잡만 import). `LOG_DELETION_ALLOWLIST`는 **빈 배열 유지**, 로그 `update*` 봉인(R-10·F-10)과 상담·설문·큐 쓰기 파일 봉인(H-2·S-2·F-9)에 이 1파일만 추가된다. 소거 트랜잭션은 기존 `enableSecureDelete()`를 재사용한다(원시 SQL 파일 수 불변).
- 파기 잡 = `PollingLoop`(5분) · KST 실행 창 · `GovernanceJobState` 임대 CAS 선점(1인스턴스) · 배치 500 + 양보 · 1회 상한 → `PARTIAL` 이어하기 · 이력 `RetentionRun`(본문·행 id 없음) · 감사 `PURGE` 요약 1건(주체 system).

### 5. 감사 무결성 = 해시 체인 + 헤드 CAS + 앵커 + 검증 (P-6 — 모드 무관 항상)

- `AuditLog`에 `seq`(유일)·`prevHash`·`rowHash`. **`AuditLogService.record()` 1곳**이 한 트랜잭션에서 싱글턴 `AuditChainHead`를 읽고 `createdAt`을 명시한 뒤 정규 직렬화(고정 순서 **배열** JSON v1)의 SHA-256(키 있으면 HMAC-SHA256)을 계산하고, 헤드를 **기대 seq 조건부 갱신(CAS)** 으로 전진시키며 행을 삽입한다. 번호는 커밋된 행에만 붙으므로 `seq` 결손 = 삭제의 증거다.
- CAS 헤드라 **Postgres에서도 잠금 없이** 정확하다. 경합은 재시도(5회) → 초과 시 **체인 없이 기록 + 경고**(감사 행 손실보다 체인 밖 행 — 검증이 `outOfChainRows`로 드러낸다).
- 방식은 행마다 접두(`s1:`/`h1:<keyId>:`)로 남아 키 추가·교체 후에도 과거 행을 검증한다.
- 기존 행은 체인 밖 — 도입 시 제네시스 앵커(행 수·최대 시각). 보존 파기로 앞부분을 지우면 마지막 삭제 행이 `RETENTION` 앵커(같은 트랜잭션).
- 검증 = `POST /audit-logs/verify`(기간·행 수 상한) + 주간 자동(파기 창) → `OK｜HASH_MISMATCH｜SEQ_GAP｜TAIL_MISSING｜ANCHOR_MISSING｜KEY_UNAVAILABLE`. 체인 머리는 부팅·파기 실행 로그·감사 CSV 표식 행·데이터 지도에 남겨 외부 대조를 가능하게 한다.
- **보증 범위를 명시한다**: 기록된 행의 무변조만 탐지 — 기록 누락·키 없는 설치의 전체 재계산·서버 장악은 탐지하지 못한다.

### 6. 권한 = 기존 권한 재사용 · 완화는 환경변수만 (P-4 (1))

데이터 지도·보존 조회·파기 이력 = `security:read` · 보존 저장·유예 취소 = `security:write` · 체인 검증·감사 내보내기 = `audit:read`(전부 ADMIN). 신규 권한·역할 0. 모드·저장 경로·출구 목록·암호화·키·하한·마스킹 강도는 콘솔에서 **읽기만**. 감사 전용 역할(직무 분리)은 2차.

### 7. 열람·내보내기 감사 = `VIEW`·`EXPORT` 액션 2종 · 열람은 선언적 데코레이터 (P-10)

- `AuditAction` 14 → 16(`VIEW`·`EXPORT`), `AuditTargetType` +6(모델명 규칙 유지). 파기 요약은 기존 `PURGE` 재사용.
- **`EXPORT`는 모드 무관 항상** — 감사로그·설문 결과·TC 결과 CSV 3곳의 서비스가 `recordExport()`(요약: 기간·행 수·필터 열거값 — 검색어·본문 없음).
- **`VIEW`는 모드 ON에서만** — 개인정보 원천 화면 **8핸들러 닫힌 목록**에 `@AuditView({ targetType, idParam })` 데코레이터 + 인터셉터 1개. 단위 = (열람자, 대상, KST 일) 1건(인스턴스 로컬 LRU + DB 확인). 상담 원문 `RAW_VIEW`는 불변(의미가 다르다 — 둘 다 남을 수 있다).
- ADR-0016이 쓰기 감사에서 인터셉터를 기각한 근거(`beforeValue` 불가 · 경로 파싱 추론 · 대량 요약 역추론)는 열람에 해당하지 않는다. 대상은 데코레이터가 이름으로 지정하고 before/after가 없다. 서비스 6곳에 감사 의존을 넣는 대안은 생성자·spec 변경과 열람 기록의 비즈니스 흐름 혼입을 부른다.

## 근거

- **"증명 가능한 레지던시"는 경로 1개 + 출구 5곳이다.** 구축형 단일 서버에서 데이터가 머무는 곳과 나가는 곳이 이것뿐이므로, 두 가지를 기동 검사와 코드 상수로 봉인하면 심사 대응 자료(데이터 지도)가 코드와 어긋날 수 없다.
- **전역 불변 런타임은 "기본값 = 현행"을 구조로 보장한다.** DI 주입은 기본값 부재(미주입 `undefined`)가 크래시가 되고, 출구 3곳이 DI 밖 클래스라 팩토리·생성자·spec이 연쇄 변경된다. 설치 1곳·읽기 전용·정적 검사로 전역 상태의 위험(숨은 변경)을 통제한다.
- **텍스트 소거는 개인정보(본문)만 지우고 통계 정의를 한 벌로 유지한다.** 행 삭제 + 롤업은 통계를 "원천 ∪ 롤업" 두 원천으로 만들고 주/월 세션 수(DD-61)를 재현하지 못한다. 상담 원문 소거(ADR-0036)가 같은 방식으로 봉인과 이미 공존한다.
- **헤드 CAS는 이식 가능한 직렬화다.** "직전 행 해시 읽기 + 삽입"은 동시 기록에서 분기(같은 prevHash 두 행)를 만든다. 헤드 행의 조건부 갱신은 SQLite·Postgres 공통 문법으로 한 번에 한 기록만 전진시킨다.
- **AAD에 행 id를 넣어야 필드 암호화가 "필드 단위"다.** AAD 없이는 DB 쓰기 권한자가 암호문을 다른 행으로 옮겨 붙여도 탐지되지 않는다.
- **완화를 환경변수로만 두는 이유**: ADMIN 계정 탈취·오조작으로 감사 흔적 삭제·출구 개방·암호화 해제가 콘솔에서 가능하면 거버넌스가 콘솔 비밀번호 하나로 무너진다. 서버 설정 변경은 운영자 권한·재기동·기동 로그를 요구한다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 레지던시 (a) 저장 경로만 / (c) 문서화만 | 규제 심사의 핵심인 "서버 밖 유출"을 막지 못하거나 강제력이 없다(P-1 (d) 확정) |
| 출구 가드를 생성자 주입(`EgressGuard` 서비스) | 출구 3곳이 DI 밖 클래스 — 팩토리·정적 생성자·기존 spec 연쇄 변경, 주입 누락 = 런타임 크래시 |
| `fetch` 래퍼 1개로 출구 통일(`egressFetch`) | 5파일의 `fetch(` 문자열이 사라져 기존 봉인(`rag-allowlist`·`validation-sealing`)의 검사 대상이 바뀐다. 가드 1줄 삽입이 봉인 변경 0으로 같은 효과 |
| 출구 차단 로그 테이블(`EgressBlockLog`) | 런타임 차단은 레거시에서만 생기고 그건 `ApiCallLog`가 이미 기록한다 |
| 루프백 자동 허용 | "어디로 가는가"를 목록 하나로 설명할 수 없게 된다 |
| DB 계층 암호화(SQLCipher·libSQL) | Prisma SQLite 엔진 미지원 — 드라이버 교체는 범위를 넘는다 |
| `packages/field-crypto` 신설 | 소비자 1곳 — 승격 규약(소비자 2곳) 미충족 |
| 결정론적 암호화(같은 평문 = 같은 암호문)로 대화로그까지 1차 암호화 | 빈도 분석에 취약하고 질문 순위 `groupBy`·유일 키가 여전히 키에 결합된다 — 2차 블라인드 인덱스가 정석 |
| 키 id별 행 수 카운트 캐시 테이블 | 상담·설문 적재마다 카운터 갱신 + 소거·재암호화와 정합 유지 — 기동 1회 접두 검색이 더 싸다 |
| 보존: 행 삭제 + 같은 트랜잭션 롤업(ADR-0033 대안 B) | 통계 2원천·세션 재현 불가·롤업 테이블 4종 — PM이 (a) 확정. 규제가 "행 삭제"를 요구하면 2차에 소거 뒤 더 긴 기한으로 얹는다 |
| 미응답 큐 종결 항목 행 삭제 | 큐 봉인(R-2) 변경 + 재발생 판정 근거 소실 — 소거 + 센티넬 키가 더 작다 |
| 체인: "마지막 행 해시 읽기 + 삽입"만 | 동시 기록에서 체인 분기 |
| 체인: Postgres 권고 잠금·`SELECT … FOR UPDATE` | SQLite 공통 문법이 아니다 — 헤드 CAS가 양쪽에서 같다 |
| 체인 실패 시 기록 포기(경고만) | 감사 행 자체를 잃는다 — 체인 밖 기록이 검증에 드러나므로 더 낫다 |
| 신규 `AuditAction` `RETENTION` | `PURGE`와 판정·필터 차이 0 |
| 열람 감사: 모든 GET | 볼륨 폭증·신호 소실(ADR-0016 판단 유지) |
| 열람 감사: 서비스 명시 호출 | 서비스 6곳 생성자·spec 변경 · 열람 기록이 비즈니스 흐름에 섞인다 |
| 감사 CSV: 응답 헤더로 체인 정보 | 브라우저 다운로드 파일에 남지 않는다 |
| 신규 권한 `governance:write` / 역할 AUDITOR | 부여 대상이 ADMIN뿐이라 판정 차이 0 / 역할 5종은 매트릭스 전체 파급 — 2차 |

**감수하는 비용**

1. **전역 불변 상태 3종**(런타임·마스킹 강도·키링)이 생긴다 — 설치 1곳·`ForTest` 리셋·정적 검사로 통제하고, Jest의 파일별 모듈 레지스트리가 시험 간 누수를 막는다.
2. **소거 뒤에도 행과 `sessionId`(가명 난수)가 남는다** — "행 자체 삭제"가 요구되면 2차.
3. **종결 미응답 항목 소거 후 같은 질문은 새 항목이 된다**(재발생 카운트 연속성 끊김).
4. **필드 암호화는 서버·환경변수 장악을 막지 못한다**(키와 DB가 같은 호스트) — 화면·문서에 정직하게 표기.
5. **`secure_delete`는 DB 페이지만 덮는다** — 저널·WAL·백업 잔존은 디스크 암호화 운영 전제.
6. **감사 기록 지연이 헤드 읽기·갱신 1쌍만큼 늘고**, 체인 경합 폭주 시 체인 밖 행이 생길 수 있다.
7. **암호화를 켠 설치는 API 롤백 금지**(구버전은 봉투를 평문처럼 표시) — 전진 수정만.
8. 로그·상담·설문·큐 **쓰기 봉인 5곳에 writer 1파일이 예외로 추가**된다(X-2~X-5) — 쓰기 데이터 키를 정적 검사로 제한(G-8)해 "무엇이든 쓰는 파일"이 되지 않게 한다.

## 결과

- 신규: `RetentionPolicy`·`RetentionRun`·`AuditChainHead`·`AuditChainAnchor`·`GovernanceJobState` · `AuditLog.seq/prevHash/rowHash` · `textPurgedAt` 4테이블 + 인덱스 3 · 마이그레이션 1개(전부 `ADD COLUMN`/`CREATE` — 부분 유니크 4종 보존 · 백필 0).
- 신규 모듈 `governance`(export 0 · 컨트롤러 2 · 관리자 11 핸들러) + `POST /audit-logs/verify` · `@Public()` 8 유지 · 신규 `ApiErrorCode` 2종(`EGRESS_HOST_NOT_ALLOWED`·`RETENTION_OUT_OF_RANGE`) · `ApiCallOutcome` +1 · `AuditAction` +2 · `AuditTargetType` +6 · 선택 환경변수 18종 + 키 2종(스키마 밖) · 신규 권한·역할 0.
- `packages/pii-mask`: `maskPii(text, { mode })` · `configurePiiMaskMode()` — PARTIAL 결과 바이트 동일.
- 봉인 `governance-sealing.spec.ts` G-1~G-18 · 의도된 기존 시험 기대값 변경 X-1~X-8(설계서 §21.2 닫힌 목록).
- **모드 OFF(기본)에서 공개·관리자 API 응답·통계 바이트 동일, 요청 경로 추가 조회 0.** 예외는 P-10이 요구한 `EXPORT` 감사 1건과 감사 CSV의 체인 2열·표식 행이다.
- `test-automation` 필수 인계: 모드 OFF 무변경 회귀 · 기동 실패 3종 · 레거시 차단(송신 0) · 암호화 왕복·AAD 교차 · 키 교체 · 소거 후 통계 수치 동일 · 파기 중 로그 유실 0 · 체인 변조·동시성 · 열람 1일 1건 · 봉인.

## 재검토 트리거

- **규제 심사가 대화로그 본문 암호화를 명시 요구** → 2차: `userMessageDigest`·`questionDigest`(HMAC 블라인드 인덱스) 컬럼 + 대표 행 복호화 · 읽기 17파일 · 봉인 재검토.
- **구독형 규제 고객 · 테넌트 키 요구** → `KeyProvider` KMS/HSM 구현체(교체 지점 1곳) + 챗봇/그룹별 키 id.
- **"행 자체 삭제" 규제 해석 확정** → 소거 후 더 긴 기한의 롤업 선적재 + 행 삭제(ADR-0033 대안 B — `LOG_DELETION_ALLOWLIST`에 서비스 1파일).
- **정보주체 파기 요청 절차 확정** → 세션 단위 소거(`sessionId`를 아는 경우) — writer에 메서드 1개.
- **SIEM·외부 봉인 요구** → 새 외부 출구 클래스(레지스트리 등록) + 체인 머리 주기 전송.
- **금융 고객 직무 분리 요구** → 역할 AUDITOR(`audit:read`+`security:read`) — ADR-0015 트리거.
- **Postgres 전환** → `secure_delete` 대체(VACUUM 정책) · 체인 헤드 CAS 유지 확인 · 인덱스 `CONCURRENTLY`.
- **ml-worker가 원격이어야 하는 규제 고객** → 질의 임베딩 마스킹 또는 전송 구간 TLS 강제 옵션.
- **v1 평문 토큰이 스냅샷에 남은 채 규제 심사** → 스냅샷 스크럽 도구(ADR-0034 §7 판단 재검토).
