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

## 2026-09-23 — 046630d

feat: 검증/품질 고도화(No.19 대화검증시스템·TC테스트 + No.20 학습영향도 TEST) 기능그룹 구현

- No.19 대화검증시스템·TC테스트: 테스트셋/TC CRUD, 엑셀/CSV 임포트(정규화 유일성), 테스트런 실행기(임베딩·RAG·의도분류 오버레이 포함), 판정(judge-test-case)·요약(summarize-run) 로직, 챗봇당 동시 실행 1건 부분 유니크 인덱스 제약(TOCTOU 최종 방어선) 구현(apps/api/src/validation 신설, ADR-0029)
- No.20 학습영향도 TEST: 예문 증강 제안을 실제 반영 전 별도 테스트런으로 비교 검증하는 영향도 체크 파이프라인(test-run-compare, 리소스 격리) 구현(ADR-0030), AugmentationPanel에 영향도 체크 버튼/세트 선택 다이얼로그 추가
- 관리자 콘솔 9번째 탭 "대화검증" 신설: 테스트셋/TC 목록·상세, 테스트런 목록·상세(진행률 폴링)·비교 화면, 시뮬레이터 연동, 결과 CSV 내보내기
- 공통 로직 승격/추출: apps/api/src/common/lib/output-diff.ts(시뮬레이터 compare-diff와 공유), apps/api/src/embedding/lib/assemble-semantic-input.ts(의미매칭 입력조립 공용화)
- Prisma 스키마 확장 및 마이그레이션(20260922225951_validation_regression_schema, 부분 유니크 인덱스 raw SQL 포함), env.validation에 TEST_SET_*/TEST_CASE_*/TEST_RUN_* 선택 환경변수 추가(전부 기본값 있음)
- ADR-0007/0015/0016/0022/0027에 이번 그룹 영향 반영 블록 append, 개발명세서.md 대규모 갱신(결정 31, Permission 15종, API 21개 등)
- code-reviewer 1차 High 1건/Medium 2건/Low 2건 발견 → 재작업으로 High는 완화 확인·Medium 2건 RESOLVED, 잔여 Low 2건은 설계서 §14 알려진 제한사항으로 기록
- test-automation 단계 신규 89건 추가, 새 버그 없음

## 2026-09-23 — 4df33bd

feat: 챗봇 복원/버전 이력관리(No.25) 기능그룹 구현

- 대화 자산(대화노드·의도·키워드·FAQ·증강 예문 등) 시점 스냅샷: 수동 생성 + 대량변경(임포트/일괄승인/일괄해결 등) 직전 자동 스냅샷 8지점, 직전 스냅샷과 콘텐츠 해시 동일 시 생성 생략
- ID 보존 원자적 복원: 복원 직전 현재 상태를 동일 트랜잭션에서 백업 스냅샷으로 저장 후 적용, 사후 콘텐츠 해시 검증, 관련 분류기 모델 삭제, 임베딩 증분 재색인 예약(apps/api/src/versions 신설, ADR-0031)
- 버전 간 차이 비교 3단계(요약 카운트 → 항목별 변경종류 → 필드 diff), 대상 항목 상세 드로어
- 보존 정책: 자동 스냅샷 최근 30개, 수동 스냅샷 최근 30개, 고정(핀) 스냅샷 최대 10개, 챗봇당 스냅샷 총량 300MB 상한
- 신규 Permission 0종(복원 = dialogue:write AND chatbot:write, @RequirePermission 복수 인자 AND 조합 지원으로 확장)
- Prisma 스키마 확장: 신규 테이블 3개 추가, 기존 컬럼 변경 0건(마이그레이션 20260923102638_version_history_schema)
- ReindexQueueService 재실행 예약 시 플래그 미정리로 후속 예약이 무시되던 결함 보완
- 관리자 콘솔에 "버전 이력" 탭 신설: 목록/생성/상세(콘텐츠 보기)/차이 비교/복원 다이얼로그, 기존 대량변경 화면에 자동 스냅샷 사전/사후 안내 배너 추가
- code-reviewer 3라운드 통과(Critical/High 0건)
- 테스트 api 974 / web 224 통과

## 2026-09-24 — dfc7d42

feat: 운영 예약 배포(No.28) 기능그룹 구현

- DeploySchedule 테이블 신설 및 챗봇당 활성 예약 충돌 방지용 부분 유니크 인덱스(마이그레이션 20260923150000_deploy_schedules_schema), 액션 3종(RESTORE_VERSION/PUBLISH/SET_WEB_CHANNEL) 지원(apps/api/src/deploy-schedules 신설, ADR-0032)
- 실행 엔진: in-process 30초 DB 폴링 루프(PollingLoop, CLOCK 주입으로 테스트 결정화) + CAS 기반 claim + lease로 다중 인스턴스 동시 실행 방지, misfire 10분 허용 윈도우 초과 시 MISSED 처리
- 콘텐츠 해시 불일치 시 실행 스킵(미실행) 및 동일 챗봇 후속 예약 HELD 전이, 일시적 오류는 재시도, 영구 오류는 실패로 분류(recovery-judge/outcome-classifier)
- version-restore.service의 RESTORE_BUSY를 별도 예외로 분리하고 actorOverride 지원(예약 실행 시 시스템 액터로 기록), retention prune이 스케줄이 참조 중인 버전을 보존하도록 보완
- env boolean 값 파서 신설(env-boolean.ts)로 환경변수 불리언 파싱 규칙 명시화
- 관리자 콘솔: 챗봇별 예약 탭(생성/목록/상세/체인 패널/결과 요약), 전역 예약 페이지(24시간 요약 바), 주의 필요 배지, 엔진 비활성 배너, 예약 충돌 배너
- apps/api/src/validation/lib/validation-sealing.spec.ts의 금지 모듈명 오타('FaqModule'→'FaqsModule') 수정 및 금지 목록이 실제 선언된 Module 클래스인지 사전 단언하는 assertion 추가
- 테스트 api 1228 / web 289 전건 통과, 미자동화 항목(AC-D2-6/AC-D2-9/AC-D3-7 BUSY분기/AC-D5-3, ScheduleDeployDialog axe)은 문서에 기록

## 2026-09-24 — fe693fd

feat: 통합 통계(No.29) 기능그룹 구현

- 콘솔 홈 `/`를 통합(전역/그룹) 통계로 대체 — 누적 KPI·기간 시계열·분포·기여 표(최대잔여법, 기타/미귀속 행)·질문 순위(보관 챗봇 포함 토글), `/stats/integrated/*` 7개 엔드포인트, 챗봇 스코프 의도별 매칭(`GET /stats/intents`)
- 누적 보존: 원천 ConversationLog 직접 집계(롤업 없음) + 로그 삭제 경로 0건 정적 검사 봉인(ADR-0033), 롤업 재검토 트리거
- `ConversationLog.groupId` 대화 당시 그룹 스냅샷(record() 4개 호출부 필수화, 추가 조회 0) + 멱등 백필 스크립트, 비파괴 ADD COLUMN 마이그레이션
- 그룹 삭제 시 이력 있으면 보관(`ChatbotGroup.archivedAt`), 보관 그룹 대상 지정 7지점 404, `Chatbot.archivedAt`
- 세션 distinct 원시 SQL 격리 파일, summary-assembler 공유, dashboard-period KST 헬퍼 중복 제거, breakdown 전용 쿼리 스키마
- 신규 권한·오류코드·환경변수 0건, 엔진 불변, 기존 통계/대시보드 무회귀
- 테스트 api 1315(로컬 데모 .env 기인 기지 실패 1건 제외 시 전부 통과) / web 338, 코드리뷰 2회차 PASS. 배포 순서: 마이그레이션 → API → 백필 스크립트.

## 2026-09-24 — 261e7b1

feat: 레거시 API 연동(No.26) 기능그룹 구현

- 대화 노드 API 조건분기(v2) 실행: 엔진 정지점→API 계층 1회 호출→순수 재진입(resumeAfterApiCall), 엔진 수정 닫힌 목록 5곳 + 엔진 I/O 0건 정적 검사, 응답 매핑·조건/기본/실패 분기·{api.이름} 치환(같은 턴·텍스트 필드만)
- ADMIN 관리 전역 API 연결 레지스트리(ApiConnection), 시크릿은 DB 미저장(secretRef + env LEGACY_API_SECRET__<REF>), 연결 테스트·샘플 응답·회로차단(인프라 실패만 계수)
- SSRF 방어: 루프백·링크로컬·메타데이터(IPv4 매핑·NAT64·6to4 포함) 절대 차단, 사설 대역은 env allowlist만, DNS 1회 해석·검증 주소 고정 접속, 리다이렉트 불추종, 256KB·JSON만, 경로 인젝션 차단, 신규 의존성 0
- 개인정보 기본 마스킹 송신(연결별 원문 허용 예외), ApiCallLog 메타데이터만
- v1 노드: 실행 안 함·신규 저장 400(API_OUTPUT_LEGACY_FORMAT)·응답에서 헤더 값 가림(VIEWER 평문 토큰 노출 해소)
- 시뮬레이터 MOCK 기본/LIVE 제한(simulation:write+GET+저장본 동일성), TC 항상 목(apiMockA/B)
- 참조 무결성: API 분기 대상 노드를 참조 검사 4곳에 편입(기존 누락 결함), 저장 시 참조 오류를 위치별 필드 경로로 보고
- 콘솔: API 연결 관리, v2 편집기(인라인 오류·미리보기·치환 미리보기), v1 읽기전용 카드·전환, 시뮬레이터 외부 API 단계, 외부 연동 로그
- 신규 오류코드 2종(API_OUTPUT_LEGACY_FORMAT, API_CONNECTION_IN_USE), 신규 권한 0종, ADR-0034
- 테스트 api 1446 / web 376 / engine 90 전부 통과, 코드리뷰 2회차 PASS
- 배포 시 할 일: 신규 API 연결별 시크릿을 서버 env(LEGACY_API_SECRET__<REF>)에 설정, 사설 대역 호출이 필요하면 배포 환경 allowlist를 추가 구성, 기존 v1 조건분기 노드에 노출된 토큰은 교체 후 v2로 전환 권고

## 2026-09-25 — a7c06a8

feat: 설문관리(No.27) 기능그룹 구현

- 대화 중 멀티턴 설문 실행: 엔진 순수 모듈 survey-session.ts, S0 단계, 엔진 수정 닫힌 목록 9항목, 엔진 I/O 0건. 클라이언트 봉투에는 진행 위치만 두고, 필드가 없으면 기존과 바이트 동일
- 서버 응답 원장: 매 턴 재검증, 적재 가드 7종, 조건부 updateMany 원자성. 세션당 1회 완료 + isDuplicate 표시. 자유 텍스트는 금지어→PII 마스킹. 응답 삭제 경로 0건(정적 봉인 S-1~S-14)
- 챗봇별 설문 정의(최대 50): 4유형(단일/다중/척도 별점·NPS/자유 텍스트), 상태 DRAFT/OPEN/CLOSED, 기간(종료일 배타), 첫 응답 후 구조 잠금(문구만 수정, 구조 변경은 복제), 위젯 변경 0(버튼 5개 분할, 다중 "1,3" 입력)
- 결과: 참여·완료·이탈·문항별 분포·평균·NPS(노출일 KST, 조회 시점 이탈 판정, 일/주/월), 문항별 답을 포함한 응답 목록, 자유 텍스트 목록, CSV 2종(수식 인젝션 방어, 한글 파일명 filename*)
- 설문 턴(ConversationLog.surveyTurn)은 질문 순위 5곳·미응답·RAG에서 제외. 기존 수치 불변
- v1 SURVEY: 실행 안 함, 신규 저장 400(SURVEY_OUTPUT_LEGACY_FORMAT). 참조 무결성 4곳 편입, 설문 삭제 409 2종, 영구삭제 사전검사 11종, 복원 경고 3종
- 결함 수정: API 분기 턴 설문 상태 유실(resumeAfterApiCall), 오버레이 설문 유실(mergeOverlay), 설계 점검 상수 판정, CSV 한글 헤더 ERR_INVALID_CHAR. No.26 legacy 통합 시험 간헐 실패 안정화
- 신규 오류코드 4종, 신규 권한 0종, @Public 추가 0, ADR-0035
- 테스트 engine 182 / api 1511 / web 417 전부 통과, 코드리뷰 2회차 PASS
- 배포 시 할 일: 마이그레이션(20260925090000_survey_management) 적용, 기존 v1 설문 노드는 실행되지 않으므로 v2로 전환 권고

## 2026-09-25 — 4f3b871 (K-1 분리 커밋 9245ede)

feat: 하이브리드 CS(No.24) 기능그룹 구현

- 상담 콘솔 신설: 진행 중 세션 모니터링(연속 미응답 주의2·경고3), 개입·전송(마스킹 미리보기)·종료·ADMIN 강제 인수, 응답 힌트(의미 매칭 3 + 자주 쓰는 문장 3), 이력·요약
- 상담 스레드는 개입 세션에만 둔다(`HandoffSession`/`HandoffMessage`). 개입 분기는 엔진 호출 전(②.7)에 처리해 엔진 변경 0. 상담이 꺼진 챗봇은 응답 바이트가 동일하다
- 원문(P-9): 상담 중 담당자·ADMIN만 토글(기본 끔)로 볼 수 있다. `HandoffMessage.rawText`만 쓰며 3중 소거(종료 트랜잭션·60초 sweeper·60분 상한) + `secure_delete`. `RAW_VIEW` 열람 감사. 영구 저장은 마스킹본만
- 공개 폴링 `GET /public/chatbots/:slug/handoff`(`@Public` 7번째): 256비트 상담 토큰을 1회 발급하고 해시만 저장. 관리자 경로에는 `sessionRef`만 노출. 구버전 위젯 편승(G-8 전치)
- `AGENT` 역할과 `cs:read`/`cs:write` 권한(역할 4, 권한 17). 부분 유니크 + CAS 배정, 서버에서 담당자 재검증(`isMine`)
- 위젯 상담 모드(gzip 11.16KB): 토큰을 봉투와 분리된 sessionStorage에 보관, 헤더 병합 결함 수정
- `ConversationLog.handoffTurn`을 질문 순위·미응답·RAG에서 제외. 영구삭제 사전검사 13종, 봉인 H-1~H-17
- K-1(선행 분리 커밋 9245ede): 공개 폴링 경로 전용 레이트리밋 버킷 도입 — 보류 답변 폴링이 같은 IP 뒤 일반 전송 한도를 소진하던 결함 수정, 상담 폴링도 동일 장치 재사용
- 시험 인프라 결함 수정: 통합 시험 DB를 `migrate deploy`로 생성(부분 유니크 인덱스 동시성 방어 미검증 해소), `DEPLOY_SCHEDULE_ENABLED`·`HANDOFF_SWEEPER_ENABLED` 기본 끔, 설문 spec UTC today 수정, 설문 seed 멱등화
- 신규 오류코드 7종, ADR-0036
- 테스트 api 1668 / web 458 / widget 95 / engine 182 통과, 코드리뷰 2회차 반영
- 배포 시 할 일: 마이그레이션(20260925100000_hybrid_cs) 적용 → 상담원에게 AGENT 역할 부여 → 챗봇별 상담 설정 활성화 → 위젯 갱신 권장(구버전은 편승 전달로 당장 깨지지 않음)

## 2026-09-25 — ce9fba6 (K-1 분리 커밋 8519c03)

feat: 토픽 시스템(No.22) 기능그룹 구현

- 챗봇 안 토픽: 평면 분류, 자산 6종 nullable `topicId`, 공통 = 항상 활성, 챗봇당 50개. 토픽 관리(대화설계 8번째 메뉴), 목록 필터(URL 유지)와 일괄 지정(`updatedAt` 보존), 활성/비활성과 영향 미리보기, 설계 점검 규칙 4종, 토픽 단위 내보내기/가져오기
- 비활성 토픽은 대화 번들 조립 시 제외한다. 엔진 변경 0. 시뮬레이터 "비활성 토픽 포함" 토글. `ConversationLog.topicId` 적재
- 토픽 → 새 챗봇 분리(복사): 참조 폐포 동반, 시작·폴백 범위 밖 연결은 기본 잘라내기(FOLLOW 옵션, `TRIM_WOULD_EMPTY` 보고), ID 순서·타임스탬프 보존으로 동점 승자 유지, 새 챗봇은 DRAFT·원본 불변, 동기 상한을 캡처 전에 사전 검사
- 버전 스냅샷은 `topicId`가 없으면 해시 불변. 복원 시 없는 토픽은 공통으로 정규화. 토픽 노출 변화 시 `acknowledgeTopicExposure` 확인 필수, tx 안에서 재검증(`RESTORE_PREVIEW_STALE`)
- 공개 응답의 topic 노출 0을 정적 검사 T-13으로 확인(zod 재귀 스캔 + 개수 가드)
- 병합은 2차(충돌 규칙만 문서화). 신규 권한 0, 오류코드 4종, ADR-0037
- K-1(선행 분리 커밋 8519c03): 대화 번들 조회 `findMany` 7종에 결정적 정렬(`createdAt asc, id asc`) 도입 — 같은 예문을 가진 의도 사이의 동점 매칭 승자가 DB 행 순서에 따라 바뀌던 결함 수정
- 시험 안정화: hybrid-cs-hardening 폴링·KST today, legacy-api 타이밍 단언
- 테스트 api 1935(3회 연속 통과) / web 520 / widget 95 / engine 182 통과, 코드리뷰 2회차 PASS
- 배포 시 할 일: 마이그레이션(20260925110000_topic_system) 적용(자산 6테이블 재정의 — API 중지 상태에서), K-1로 같은 예문 의도의 답변이 바뀔 수 있으니 배포 전후 TC 비교 권장
