# ADR-0007 — 대량 업로드: 엑셀 파서로 `exceljs` 채택(SheetJS `xlsx` 기각), 검증 결과는 메모리 스테이징

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/dialogue-design.md` §5.2 DD-7·DD-8, FR-6-19 ~ FR-6-30, FR-9-9, NFR-P5, NFR-P6, NFR-S6, NFR-S7, AC-6B-1 ~ AC-6B-10, EX-I-1 ~ EX-I-9
- **영향 범위**: `apps/api/package.json`, `apps/api/src/dialogue-common/import/*`, `packages/shared-types/src/bulk-import.ts`

## 맥락

ROCHA 원본 매뉴얼은 No.6을 "**엑셀** 대량 업로드 예문 등록"으로 명시하고, 요구사항 FR-6-20은 `.xlsx`와 `.csv`를 모두 허용한다. 현재 `apps/api`에는 스프레드시트 파서가 없다.

두 가지를 결정해야 한다.

1. **파서 의존성** — 신규 도입할지(어떤 라이브러리로), 1차는 CSV만 지원하는 축소안으로 갈지.
2. **`importToken` 스테이징**(FR-6-21) — dry-run 검증 결과를 커밋까지 10분간 어디에 보관할지.

형제 프로젝트 `Auto QA`는 루트 **devDependency**로 `xlsx@^0.18.5`(SheetJS)를 사용 중이며, 용도는 `scripts/import-eval-sheets.js`라는 **개발자 로컬 일회성 스크립트**다.

## 결정

### 1. `.xlsx` 지원을 유지하되, 파서는 `exceljs`를 쓴다. SheetJS `xlsx`(npm)는 기각한다.

- `apps/api`의 **런타임 dependency**로 `exceljs`를 추가한다(`apps/web`/`apps/widget` 번들에는 들어가지 않는다).
- 파싱 계층을 `SheetReader` 인터페이스로 추상화하고 **`CsvSheetReader`를 먼저 구현**한다. `XlsxSheetReader`는 같은 인터페이스의 두 번째 구현이다.
  ```ts
  export interface SheetRow { rowNumber: number; cells: string[]; }
  export interface SheetReader { read(buffer: Buffer, maxRows: number): Promise<SheetRow[]>; }
  ```
- CSV 파서는 **자체 구현**한다(의존성 0). BOM 제거·따옴표 이스케이프·CRLF만 처리하면 되는 2열~4열 고정 포맷이다.
- `exceljs`는 **스트리밍 리더**(`stream.xlsx.WorkbookReader`)로 사용하고, `maxRows`(5,000) 도달 시 즉시 중단한다(압축 폭탄 방어, NFR-S6).
- 업로드 파일은 `memoryStorage()`로 받아 파싱 후 즉시 폐기한다. 디스크에 남기지 않는다(NFR-S6).

### 2. dry-run 결과는 서버 메모리에 보관한다(요구사항 DD-7의 ①안). `ImportBatch` 테이블은 만들지 않는다.

- `ImportStagingStore` 인터페이스 + `InMemoryImportStagingStore` 구현.
  - 키는 `randomUUID()`, TTL 10분, 항목당 `chatbotId`·`resourceType`·커밋 계획을 보관.
  - **용량 상한**(예: 배치 20개 / 총 행 100,000)을 두고 LRU로 밀어낸다. 무한 증가로 인한 메모리 고갈을 막는다.
  - 커밋 시 `take()`로 **1회용 소비**한다(중복 커밋 차단, AC-6B-10의 서버측 보강).
  - 커밋 요청의 `:chatbotId`와 스테이징의 `chatbotId`가 다르면 `404`(토큰 교차 사용 차단).
- 만료·서버 재시작·용량 축출은 전부 동일하게 **`400 IMPORT_TOKEN_EXPIRED` + 재검증 안내**로 수렴한다(AC-6B-6).

## 근거

### SheetJS `xlsx`를 기각한 이유 (가장 결정적)

- npm에 공개된 마지막 버전은 **0.18.5**이며, 이 버전에는 **프로토타입 오염(CVE-2023-30533, 수정판 0.19.3)** 과 **ReDoS(GHSA, 수정판 0.20.2)** 취약점이 있다. SheetJS는 0.18.5 이후 npm 퍼블리시를 중단하고 자체 CDN으로 이전했기 때문에, **`npm`/`pnpm` 레지스트리에서는 고쳐진 버전을 받을 수 없다.**
- Auto QA의 사용처는 개발자가 수동 실행하는 **로컬 스크립트**(devDependency)다. 우리 쪽 사용처는 **인터넷에서 임의의 파일을 받아 서버 프로세스에서 파싱하는 경로**다. 위협 모델이 완전히 다르다 — 팀 컨벤션 재사용이라는 이유만으로 같은 선택을 하면 안 된다.
- `exceljs`는 npm에서 유지보수 버전을 받을 수 있고, 스트리밍 리더가 있어 행 수 상한과 조기 중단(NFR-S6)을 구현하기 쉽다.

### CSV 전용 축소안을 택하지 않은 이유

- FR-6-19의 검증 리포트·병합 정책·오류 행 처리 등 **파이프라인의 90%는 파서와 무관**하다. `SheetReader` 인터페이스 뒤에 붙는 어댑터 하나가 늘어날 뿐이라 xlsx 추가 비용이 작다.
- 반면 사용자 관점 비용은 크다. 관리자가 실제로 가진 파일은 `.xlsx`이고, "엑셀을 CSV로 다시 저장하세요"는 **EX-I-2(EUC-KR 인코딩으로 한글 깨짐)** 를 대량 유발한다. Excel의 "CSV로 저장"은 기본적으로 시스템 로캘 인코딩을 쓴다 — 축소안이 오히려 오류 리포트를 늘린다.
- 다만 **구현 순서는 CSV 먼저**다. CSV 리더로 파이프라인 전체(검증·커밋·오류 리포트·내보내기)를 완성해 AC-6B를 통과시킨 뒤 xlsx 어댑터를 붙인다. 일정이 압박되면 **xlsx 어댑터만 떼어 다음 Phase로 미룰 수 있다** — 인터페이스 분리의 목적이 바로 이것이다.

### 메모리 스테이징을 택한 이유

- **이 시스템은 현재 단일 인스턴스다.** Redis/BullMQ는 확장기능 Phase까지 도입하지 않기로 이미 결정했고(개발명세서 §6-4), `infra/`도 존재하지 않는다. 다중 인스턴스를 전제한 설계는 지금 검증할 수단조차 없다.
- **`ImportBatch` 테이블은 영속화할 가치가 없는 데이터를 영속화한다.** 스테이징 내용은 10분짜리 중간 계산 결과이며, 정리 배치(만료 행 삭제)가 새로 필요하고, 5,000행 계획을 JSON으로 넣으면 수 MB짜리 행이 `SQLite`에 쌓인다. ADR-0004가 "쓰기 주체가 없는 컬럼은 만들지 않는다"고 판단한 것과 같은 결의 낭비다.
- **실패 모드가 안전하다.** 메모리 소실(재시작/축출)은 곧 토큰 만료이며, 사용자는 **파일을 다시 검증**하면 된다. 검증은 DB를 전혀 건드리지 않으므로(AC-6B-2) 데이터 손상이 없다. 최악의 결과가 "재업로드 요청"인 설계는 감수할 만하다.
- **교체 비용이 인터페이스 하나다.** 수평 확장이 필요해지는 시점(No.11 채널/배포 Phase)에 `RedisImportStagingStore` 또는 `PrismaImportStagingStore`를 구현해 DI 바인딩만 바꾸면 된다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| `xlsx`(SheetJS npm 0.18.5) | 알려진 취약점의 수정 버전을 npm에서 받을 수 없다. 서버 업로드 파싱 경로에 두기에 부적절 |
| `xlsx` CDN 버전 고정(`https://cdn.sheetjs.com/...`) | 레지스트리 밖 URL 의존성은 CI·오프라인 구축형 설치·감사 추적을 모두 어렵게 한다. 구축형(On-Premise) 배포 요건과 충돌 |
| `node-xlsx` 등 경량 래퍼 | 내부적으로 SheetJS를 쓰는 경우가 많아 같은 문제를 물려받는다 |
| CSV만 지원(축소안) | 사용자 실파일이 `.xlsx`다. Excel의 CSV 저장이 EUC-KR로 나가 EX-I-2를 대량 유발한다. 파이프라인 재사용률이 높아 절감되는 비용도 작다 |
| `ImportBatch` 테이블(DD-7 ②안) | 10분짜리 중간 결과를 영속화. 정리 배치 신설 + 대용량 JSON 행. 단일 인스턴스 현 구성에 이득 없음 |
| 토큰 없이 커밋 시 파일 재업로드(DD-7 ③안) | 사용자가 같은 파일을 두 번 올려야 하고, **검증한 내용과 커밋하는 내용이 다를 수 있다**(그 사이 파일 수정). 2단계 확정 UX(S-2)의 의미가 사라진다 |
| 업로드를 Job Queue 비동기화 | GPU/장시간 작업이 아니다. 5,000행 검증 10초·커밋 20초(NFR-P5)는 동기 처리 범위이며, 큐 도입은 개발명세서 §6-4 결정에 반한다 |

**감수하는 비용**: ① `exceljs` 런타임 의존성 1건 증가(서버 전용). ② 다중 인스턴스 배포 시 스테이징이 깨진다 — 로드밸런서 세션 어피니티가 없으면 커밋이 `IMPORT_TOKEN_EXPIRED`로 실패한다. **수평 확장 착수 시점의 필수 점검 항목**으로 §12에 기록한다. ③ 서버 재시작 시 진행 중인 검증 결과가 사라진다(재검증으로 복구).

## 결과

- `apps/api/package.json`: `dependencies`에 `exceljs` 추가. `@types/multer`는 devDependency(파일 타입용).
- `dialogue-common/import/`: `sheet-reader.ts`(인터페이스), `csv-sheet-reader.ts`, `xlsx-sheet-reader.ts`, `import-staging.store.ts`, `lib/`(순수 함수 4종).
- `shared-types/src/bulk-import.ts`: 2단계 계약 + `IMPORT_LIMITS` + `escapeCsvCell()`(서버 내보내기와 프런트 오류 CSV가 공유, NFR-S7).
- 내보내기·템플릿은 **UTF-8 BOM 포함 CSV**를 기본으로 하고, `format=xlsx`는 템플릿에만 제공한다(AC-6B-1, AC-6B-9).
- 후속: 수평 확장 착수 시 `ImportStagingStore`의 Redis/DB 구현으로 교체. 취약점 모니터링 대상에 `exceljs`를 포함한다.
