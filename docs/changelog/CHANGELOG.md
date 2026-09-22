# Changelog

기능 단위 개발 완료(사용자 승인) 시마다 아래에 변경 요약을 append한다. (형식: 날짜 / 커밋 해시 / 요약)

## 2026-09-19 — a90187c

feat: pnpm 모노레포 스캐폴딩 및 챗봇 운영관리 1차 기능그룹 구현

- pnpm 워크스페이스(apps/api, apps/web, packages/*) 초기 스캐폴딩
- "챗봇 운영관리" 그룹(기능요구사항 No.1~4) 구현

## 2026-09-20 — 870e6ed

feat: 대화 설계(No.5~9) 기능그룹 구현 - 대화그래프빌더/의도키워드/동음이의어/컨텍스트/FAQ

- 대화그래프빌더(대화노드), 의도·키워드 관리, 동음이의어 사전, 컨텍스트 관리, FAQ 관리(기능요구사항 No.5~9) 구현
- 조인테이블 기반 참조무결성 적용(ADR-0005)
- 정규화 유일성 제약 도입(ADR-0006)
- 엑셀/CSV 대량업로드 파서 및 스테이징(ADR-0007)
- 매칭엔진 실행기 resolveResponse 파이프라인(ADR-0008)
- API 엔드포인트 50개, 관리자 콘솔 화면 구현
- code-reviewer 발견 High 3건 수정: 삭제차단 배너 미동작, 참조종류 라벨 오류, 노드필터 데이터유실
- 테스트 230개 추가

## 2026-09-20 — dfde1c3

feat: 품질/채널(No.10~11) 기능그룹 구현 - 응답테스트/시뮬레이션, 다양한 채널 제공

- 대화해석엔진 3층 진입점(resolveResponse/resolveByNodeId/resolveTurn) 및 pendingClarify 동음이의어 해소 파이프라인 신설(ADR-0010)
- 클라이언트 보관 세션상태 도입(ADR-0009)
- 채널 CRUD: WEB 종단 구현 + 7종 설정전용(ADR-0011)
- 공개 대화 API: Origin 가드/레이트리밋/PII 마스킹(ADR-0013)
- 신규 apps/widget 최초 스캐폴딩(런타임 의존성 0, Shadow DOM, gzip 7.46KB, ADR-0012)
- code-reviewer 발견 High 2건 수정: 오버레이 크기제한 버그, SIM1-D 진입점 누락
- 테스트 369개

## 2026-09-22 — 2cdd8b6

feat: 보안/이력(No.12~13) 기능그룹 구현 - 로그인/권한/계정잠금/금지어, 감사로그(append-only)

- 로그인/세션(idle+absolute 이중만료)/역할(ADMIN·EDITOR·VIEWER)/계정잠금/마지막 ADMIN 보호 구현(auth, users, common/auth — ADR-0014, ADR-0015)
- 금지어 사전·필터(banned-words), AuditLog append-only 기록 및 기존 9개 도메인 모듈 감사 소급(audit-logs — ADR-0016)
- rate-limit 모듈을 conversation/에서 common/rate-limit/으로 승격, request-context(AsyncLocalStorage) 신설
- apps/web 인증 도입: 로그인 화면, AuthContext, RequirePermission, 401 자동 재로그인/재시도, 회원/금지어/감사로그 관리 화면
- code-reviewer 1차+2차 통과(Critical/High 0건)
- 테스트 총 493개 Pass(api 263 / web 132 / dialogue-engine 72 / widget 26), 실패 0건
