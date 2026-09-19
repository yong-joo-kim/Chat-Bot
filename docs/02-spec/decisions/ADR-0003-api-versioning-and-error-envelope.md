# ADR-0003 — `/api/v1` 버저닝과 공통 오류 봉투 · zod 단일 검증 계층

- **상태**: 채택 (Accepted)
- **일자**: 2026-09-19
- **결정자**: system-architect
- **관련**: `docs/requirements/chatbot-operations.md` FR-0-1 ~ FR-0-5, NFR-S1, AC-5-1, AC-5-2
- **영향 범위**: `apps/api/src/main.ts`, `apps/api/src/common/*`, `apps/web/src/api/client.ts`, `packages/shared-types/src/common.ts`, `.env.example`

## 맥락

세 가지가 동시에 어긋나 있다.

1. **경로**: `개발명세서.md` §4와 요구사항 FR-0-1은 `/api/v1/`을 요구하지만, `apps/api/src/main.ts`는 `setGlobalPrefix('api')`만 설정해 실제 경로가 `/api/*`다. `apps/web/.env.example`의 `VITE_API_BASE_URL`도 `http://localhost:3000/api`다.
2. **검증**: `main.ts`는 `class-validator` 기반 `ValidationPipe`를 전역 등록했지만, 이 프로젝트의 DTO 단일 소스는 **zod(`packages/shared-types`)** 다. 두 검증 체계가 공존하면 규칙이 갈라진다.
3. **오류 형식**: FR-0-3은 `{ statusCode, code, message, details: [{ field, message }] }`를 요구하지만 NestJS 기본 예외 응답은 `{ statusCode, message, error }`이고, `apps/web/src/api/client.ts`는 응답 본문을 **아예 파싱하지 않는다**(`요청 실패: {status} {statusText}`만 표시).

이 그룹이 첫 버티컬 슬라이스이므로 여기서 정한 규약이 이후 40여 개 기능에 그대로 복제된다.

## 결정

### 1. URI 버저닝

```
app.setGlobalPrefix('api');
app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
```

- 결과 경로: `/api/v1/chatbots` 등. 컨트롤러에 개별 버전 데코레이터를 달지 않아도 기본 v1이 적용된다.
- `HealthController`는 `@Version(VERSION_NEUTRAL)`을 붙여 **`/api/health`를 그대로 유지**한다(기존 스모크 체크·배포 헬스체크 호환).
- `apps/web/.env.example`과 루트 `.env.example`의 API 베이스를 `http://localhost:3000/api/v1`로 갱신한다.

### 2. zod 단일 검증 계층

- 전역 `class-validator` `ValidationPipe`를 **제거**한다.
- `ZodValidationPipe`(body) / `ZodQueryPipe`(query) 2종을 `common/`에 두고 핸들러 인자에 `@Body(new ZodValidationPipe(Schema))` 형태로 명시 적용한다.
- 파싱 모드는 **strip**(스키마에 없는 필드 무시, FR-0-2). `ZodError.issues`를 `details: [{ field: issue.path.join('.'), message: issue.message }]`로 변환한다.
- 쿼리 파이프는 문자열→숫자/불리언 변환을 위해 스키마 쪽에서 `z.coerce`를 사용한다. 복수 선택 필터는 **콤마 구분 단일 파라미터**(`?status=DRAFT,ACTIVE`)로 통일하고 `csvEnumArray()` 헬퍼로 전처리한다.
- 응답도 같은 스키마로 계약 테스트한다(AC-5-1).

### 3. 공통 오류 봉투

- `ApiException(code, status, message, details?)`를 도메인 서비스가 던진다.
- 전역 `AllExceptionsFilter`가 다음을 단일 형식으로 변환한다.

| 입력 | 출력 |
|---|---|
| `ApiException` | 그대로 직렬화 |
| `ZodError` | `400 VALIDATION_FAILED` + `details[]` |
| Prisma `P2002` | `409 DUPLICATE_SLUG` |
| Prisma `P2003` | `409 CHATBOT_HAS_CHILDREN` |
| Prisma `P2025` | `404 NOT_FOUND` |
| 기타 `HttpException` | 상태 유지 + `code` 추론 |
| 그 외 | `500 INTERNAL_ERROR` (원본은 서버 로그에만) |

- `ApiErrorCode`/`ApiErrorSchema`는 `packages/shared-types/src/common.ts`에 두어 **프런트가 `code`로 분기**할 수 있게 한다(예: `DUPLICATE_SLUG`면 slug 필드에 인라인 오류 표시).
- `apps/web/src/api/client.ts`는 오류 본문을 `ApiErrorSchema`로 파싱해 `ApiError`에 `code`/`details`를 싣도록 확장한다. 파싱 실패 시 기존 문구로 폴백한다.

## 근거

- **버저닝을 지금 넣는 비용이 가장 싸다.** 현재 실제 API 소비자는 스캐폴딩 페이지뿐이다. 기능이 40여 개로 늘어난 뒤 경로를 바꾸면 프런트 전역과 문서·테스트·임베드 스니펫까지 동시에 손대야 한다. `enableVersioning`은 컨트롤러 코드를 건드리지 않고 한 줄로 적용된다.
- **검증 체계 이원화는 조용한 규칙 불일치를 만든다.** `slug` 규칙(소문자/숫자/하이픈, 예약어)이 zod와 class-validator 데코레이터 두 곳에 존재하면 한쪽만 수정되는 사고가 반드시 난다. zod는 이미 FE/BE 공유 타입의 단일 소스이므로 검증도 zod로 일원화한다.
- **`details[].field`가 없으면 UIUX 요건을 만족할 수 없다.** UIUX §7은 "입력 필드 하단 인라인 오류"를 요구하는데, 필드명이 없는 오류 메시지로는 어느 필드에 붙일지 알 수 없다. 즉 오류 형식은 UI 품질 기준에서 역산된 제약이다.
- **`code` enum은 메시지 문자열 매칭을 막는다.** 프런트가 한국어 메시지 문자열로 분기하면 문구 수정이 곧 버그가 된다.

## 대안과 트레이드오프

| 대안 | 기각 사유 |
|---|---|
| 헤더 버저닝(`Accept-Version`) | 임베드 스니펫·브라우저 주소창에서 확인이 어렵고, `PUBLIC_API_BASE_URL`을 위젯에 주입하는 구조와 맞지 않다 |
| 버저닝 생략, 필요할 때 도입 | 도입 시점에는 이미 소비자가 많아 비용이 폭증 |
| `nestjs-zod` 등 외부 패키지 | 파이프/필터 200줄 수준이라 의존성 추가 대비 이점이 작고, `ZodError` 변환 규칙을 직접 통제하는 편이 오류 형식 요구(FR-0-3)에 유리 |
| 전역 파이프로 zod 자동 적용 | Nest 메타데이터만으로는 핸들러별 스키마를 알 수 없다. 명시 적용이 읽기 쉽고 추적 가능 |
| 배열 쿼리를 반복 파라미터(`?status=A&status=B`)로 | 파서 설정(`extended`)에 따라 값이 1건일 때 배열이 아닌 문자열로 들어오는 케이스를 매번 방어해야 한다. 콤마 구분이 프런트 `URLSearchParams` 구성도 단순 |

**감수하는 비용**: 핸들러마다 `@Body(new ZodValidationPipe(X))`를 명시해야 해 보일러플레이트가 약간 늘어난다. 파이프 인스턴스를 스키마별로 캐시하는 작은 헬퍼(`zodBody(X)`, `zodQuery(X)`)로 완화한다.

## 결과

- `main.ts`: `enableVersioning` 추가, `class-validator` 전역 파이프 제거, `AllExceptionsFilter` 전역 등록.
- `common/`: `zod-validation.pipe.ts`, `zod-query.pipe.ts`, `api.exception.ts`, `all-exceptions.filter.ts`, `pagination.ts` 신설.
- `shared-types/src/common.ts` 신설 — `ApiErrorCode`, `ApiErrorSchema`, `PaginationQuerySchema`, `paginated()`, `SortOrder`, `SafeUrlSchema`, `csvEnumArray()`.
- `apps/web/src/api/client.ts` 확장 + `.env.example` 2종 갱신.
- 후속 모든 기능그룹은 이 규약을 복제한다. 규약 변경은 새 ADR로 남긴다.
