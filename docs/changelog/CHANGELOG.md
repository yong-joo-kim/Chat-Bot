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

## 2026-09-22 — bd4ae05

feat: 기본 통계/학습현황(No.14~15) 기능그룹 구현 - 일/주/월 통계 대시보드, 미응답 질문 검토→의도 매칭→학습 반영

- No.14 기본 통계: 일/주/월 단위 사용자현황·대화현황·질문순위·이용동향 대시보드(버킷 집계, KST 기준일, 응답소스/채널 분포, 시간대·요일 패턴)
- No.15 학습현황: 미응답 질문 수집→검토→의도명 입력/매칭→저장 시 예문 반영 및 관련 캐시 무효화(실제 딥러닝 재학습은 범위 밖 — ADR-0018)
- 신규 모듈 apps/api/src/stats, apps/api/src/learning / 신규 화면 apps/web/src/pages/stats, apps/web/src/pages/learning
- DB 스키마 변경·마이그레이션(20260922024448_stats_learning_schema) 및 기존 대화로그 백필 스크립트 추가
- ADR-0017(시계열 버킷 전략)~ADR-0019(미응답 큐 수집 모델) 및 요구사항·설계·UI 명세·시험 문서 추가
- code-reviewer 1차 Medium 2건 발견→수정, 2차 재검토 통과(Critical/High/Medium 0건)
- 테스트 총 617개 Pass(api 356 / web 163 / dialogue-engine 72 / widget 26), 실패 0건

## 2026-09-22 — 799392c

feat: FAQ/의도 매칭 고도화(1단계 NLU 유사도 검색 + 2단계 외부 RAG 폴백) 기능그룹 구현

- 1단계 NLU: apps/ml-worker(추론 전용 임베딩 서비스, 골든셋 스윕으로 KURE-v1 확정) 신설 + apps/api/src/embedding(provider/색인/캐시/의미매칭) + packages/dialogue-engine 의미 유사도 매칭기, 매칭 점수 주입 및 임계값 밴드(ACCEPT/CLARIFY/REJECT) 도입(ADR-0020, ADR-0024)
- 2단계 외부 RAG: apps/api/src/rag(게이트/HTTP 클라이언트/응답 검증/allowlist 봉인) + 비동기 보류답변 폴링 배달(ADR-0022, ADR-0023)
- 챗봇별 답변 설정(1:1, ChatbotAnswerSetting) 신설: apps/api/src/answer-settings + apps/web answer-settings 화면(임계값 밴드/폴백정책/RAG 스코프, ADR-0021)
- packages/pii-mask 신설: apps/api/conversation/lib의 PII 마스킹을 공용 패키지로 승격
- DB 스키마 확장(EmbeddingVector/ChatbotAnswerSetting/RagCallLog) 및 마이그레이션(20260922070337), ConversationLog.answeredByRag 추가로 No.14 응답출처에 RAG 반영
- apps/web 시뮬레이터에 매치스코어 패널/RAG 사용 토글, apps/widget에 보류 응답 폴링(pending-poll) UI 추가
- @Public() 핸들러 6개로 갱신(보류 답변 폴링 엔드포인트 추가, security-audit.md AC-C-4)
- code-reviewer 1차 High 1건/Medium 2건 발견→수정, 2차 재검토 통과(Medium 1건은 잔여 리스크로 문서화)
- 테스트 신규 46건 추가, 총 768개 Pass(api 459 / web 170 / dialogue-engine 86 / widget 45 / pii-mask 8), 실패 0건 + apps/ml-worker(pytest) 9개 별도 Pass

## 2026-09-23 — 77686fb

feat: 학습 고도화(No.16 예문 증강 + No.23 요소분해/경량 분류기) 기능그룹 구현

- No.16 예문 증강: 규칙(G1)/Gemini/로컬 3-포트 증강 프로바이더(ADR-0026), 제안-자산 시각적 분리(ADR-0025)로 승인 전까지 예문 자산에 반영되지 않는 파이프라인 구현, apps/api/src/augmentation 신설
- No.23 요소분해/경량 분류기: 한국어 형태소 분석기 3단 폴백(garu-ko/휴리스틱, ADR-0028)과 로지스틱 회귀 경량 분류기(ADR-0027) 구현, apps/api/src/classifier·apps/api/src/learning/{decompose,decomposition,decomposed-resolve} 신설
- 비동기 학습 작업 큐(training-jobs) 신설: 증강 생성/분류기 학습 잡을 폴링 기반으로 처리(AsyncJobProgress, useTrainingJobPolling)
- apps/ml-worker에 생성 프로파일 추가(ML_WORKER_ROLE=embed|augment|both, generator.py) 및 5지표 실측 기반 생성모델 후보 비교(eval/generation_candidates.py, generation-model-comparison.md)
- apps/web: AugmentationPanel/AugmentationSuggestionTable(대화설계), ClassifierStatusPanel/DecompositionSection(학습현황) 신규 화면, NodeUnlinkedWarningBanner를 LearningLinkWarningBanner로 대체
- Prisma 스키마 확장 및 마이그레이션(20260922124208_learning_augmentation_schema), env.validation에 AUGMENTATION_*/CLASSIFIER_*/MORPH_* 선택 환경변수 추가(전부 기본값 있음, 미설정 시 규칙 증강+분류기 비활성+휴리스틱 폴백으로 정상 기동)
- code-reviewer 1차 Critical 2건/Medium 1건 발견→수정(이벤트루프 버그 RESOLVED), 2차 재검토에서 영구삭제 트랜잭션 미사용 Medium 신규 발견→트랜잭션화로 수정
- test-automation 단계에서 금지어 공백 항목 오탐 실사용 버그 1건 발견→수정
- 테스트 총 1004개 Pass(api 689 / web 176 / dialogue-engine 86 / widget 45 / pii-mask 8), 실패 0건 + apps/ml-worker(pytest) 16개 별도 Pass
