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

## 2026-09-25 — 8d9e2fd (선행 분리 커밋 4e4abd5)

feat: 피드백 기반 개선 루프(No.44) 기능그룹 구현

- 위젯 봇 답변마다 👍/👎, 공개 평가 API `PUT /public/chatbots/:slug/messages/:messageId/feedback`(`@Public()` 8번째): 토큰 없이 (슬러그의 챗봇, 요청 `sessionId`, `messageId`)와 로그 행이 전부 일치하고 `feedbackOffered`일 때만 저장, 어긋나면 전부 같은 404. 평가 전용 레이트리밋 버킷(`fb-ip` 120/분 · `fb-key:msg` 10/분)으로 대화 전송 한도와 분리
- 평가 원장 `MessageFeedback`: 메시지(`ConversationLog` 1행)당 1행 · 변경 24시간·5회 · 취소 없음 · 텍스트·`sessionId` 컬럼 0(최소 수집) · 쓰기는 `feedback/message-feedback.service.ts` 1파일뿐. 첫 👎 확정 시 원장의 선점 상태 기계(`queueOutcome` CAS)로 정확히 한 번만 학습현황 큐에 `NEGATIVE_FEEDBACK` 소스로 편입
- 학습현황 콘솔: 소스 탭(답변 못함/부정 평가), 당시 봇 답변(마스킹본)·매칭 대상 표시, "현재 매칭" 배지, "직접 수정 완료"(의도 없이 `RESOLVED`) 전이
- No.14 통계 "답변 만족도" 섹션(`GET /stats/feedback`): 평가 수·긍정률·참여율(분모 `feedbackOffered` 턴)·추이·👎 집중 답변
- 위젯: `feedback-v1` 기능 선언 + 봇 말풍선 평가 막대(vanilla · 런타임 의존성 0 · gzip 100KB 게이트 준수)
- WEB 채널 설정 `feedbackEnabled` 스위치(기본 꺼짐) — `access.resolve()`가 이미 읽는 행이라 추가 조회 0, 꺼진 챗봇 응답은 키 생략으로 바이트 동일
- 엔진(`dialogue-engine`) 변경 0건 — 응답 조립 직전 순수 판정만 추가
- 선행 분리 커밋 4e4abd5(큐 소스 분리 준비): `UnansweredQuestion` 유일 키를 `(chatbotId, source, questionNormalized)`로 교체, 기존 수집기(`collect()`)의 조회·생성·상한 계수에 `source='UNANSWERED'` 명시, `stats.service.ts#getQuestions` 큐 딥링크 조회에 `source` 조건 추가 — 도입 시점 모든 행이 `UNANSWERED`라 동작 불변, 기존 시험 무수정 전부 통과
- 신규 ADR-0038(답변 평가 = 메시지 능력 결합 검증·텍스트 없는 평가 원장·큐 소스 분리·평가 전용 레이트리밋·선점 상태 기계). 기존 ADR(0002/0011/0012/0015/0019/0023/0033) 각주 갱신
- PM 결정 요점: 기능 기본 꺼짐(`feedbackEnabled`) · 👎 1회 즉시 편입 · 부정 평가 대기 상한 2,000 · 자유 텍스트 사유 없음 · 신규 권한·역할·감사 0 · GPU 카탈로그 2 유지(이 그룹이 만드는 연산은 전부 조회·순수 판정·`groupBy`)
- 테스트 api 2652 / web 561 / widget 133(gzip 12.49KB) / engine 182(변경 0) 통과, 코드리뷰 통과
- 배포 시 할 일: `prisma migrate deploy`(마이그레이션 `20260925115000_queue_source_split` → `20260925120000_feedback_loop` 순서 적용) → 필요 시 챗봇별 WEB 채널 설정에서 답변 평가 받기 스위치를 켠다
- 롤백 제약: `NEGATIVE_FEEDBACK` 행이 하나라도 생기면 이전 유일 키 `(chatbotId, questionNormalized)`로 되돌릴 수 없다(같은 정규화 질문의 두 소스 행이 옛 키를 위반). 롤백 전 해당 행을 정리해야 하며, 배포 절차는 "API 롤백까지만, 스키마는 유지"를 기본으로 한다
- 알려진 한계: FB-S1 긍정률 선(추이 그래프) 미구현(요약 문장과 표로 대체) · `TabNav`의 학습현황 요약(summary) 호출이 챗봇 상세 진입마다 1회 발생 · 미커버 시험 FB1-3/FB5-6(쿼리 수)·FB8-2(감사 수)·EX-15/20/22 · `learning-augmentation` 통합 시험을 전체 스위트와 병렬 실행할 때 간헐 실패(이 그룹 범위 밖, 기존 결함)

## 2026-09-26 — 11ae7e2 (선행 분리 커밋 6b0ce0f)

feat: 환경 분리/버전 관리(No.40) 기능그룹 구현

- 한 챗봇 안에 초안(DRAFT) → 스테이징(STAGING) → 운영(PROD) 3단 포인터를 도입한다(ADR-0039). 포인터 저장 위치는 운영 = `Chatbot.prodVersionId`, 스테이징·게이트·켜짐 메타는 1:1 `ChatbotEnvironment`. 대화 자산 편집·저장은 항상 초안에만 영향을 주고, 스테이징 승격(`dialogue:write` ∧ `chatbot:write`) → 운영 전환(즉시 또는 No.28 예약 `SWITCH_PROD_VERSION`) → 롤백(직전 운영 버전으로 포인터만 되돌림)까지 한 흐름이다. 모든 전환·롤백·모드 켜기/끄기는 append-only 이력 `EnvironmentSwitchLog`에 남는다
- PM 결정 요점(P-1~P-12, 전부 추천안 채택): P-1 1차 범위는 서버 내 환경 포인터만(서버 간 export/import·복제 챗봇 체인은 2차) · P-2 3단 고정, 운영 전환 대상은 현재 스테이징 또는 운영 이력 버전(롤백)만 · P-3 즉시+예약 전환(비율 분할은 2차), 로그 `servedVersionId`는 1차부터 적재 · P-4 신규 권한 `chatbot:deploy`(ADMIN 기본, 승격은 편집자도 가능) · P-5 게이트는 경고 기본+챗봇별 차단 선택, 롤백엔 경고만, 자동 롤백 없음 · P-6 켜기는 현재 상태로 포인터 자동 초기화(응답 불변), 끄기는 매번 선택(기본 "운영 유지") · P-7 복원은 초안에만, 운영 되돌리기는 포인터 롤백 · P-8 모드 켤 때 기존 활성 `RESTORE_VERSION` 예약은 `HELD(ENV_MODE_CHANGED)` · P-9 스냅샷 밖 자산(설문·API 연결·상담 설정·자주 쓰는 문장·채널·금지어·토픽 정의/활성)은 즉시 운영 반영+화면 안내 · P-10 위젯 이름/아바타/스킨은 운영 버전 값, 인사말/퀵리플라이/런처는 채널 설정 · P-11 통계는 로그 귀속만(비교 화면 2차) · P-12 GPU 1, 구축형·구독형 전부 적합(망분리 구축형은 2차)
- C-1 동점 일치(해시 밖 보조 필드): 스냅샷 봉투에 `tiebreak.nodeUpdatedAt`(해시 밖 보조 필드)을 캡처해 `contentHash`는 불변으로 유지하고, `ChatbotVersion.tiebreakHash`로 "재사용" 판정(`contentHash` ∧ `tiebreakHash` 동일)을 강화한다. 서빙 역직렬화 `hydrateForServing()`이 노드 `updatedAt`을 복원하고 6종 배열을 `createdAt asc, id asc`로 재정렬해 라이브 `build()`와 동일한 동점 판정을 재현한다. 보조 필드 없는 과거 스냅샷은 실제 동점 가능성이 있을 때만 `LEGACY_TIEBREAK` 경고를 띄운다
- C-2 문장 해시 벡터 보존: `EmbeddingTextVector`(문장 해시 주소 저장소, `(chatbotId, modelId, textHash)` 유니크)를 신설해 환경 포인터가 참조하는 버전의 질의 벡터를 초안 편집·재색인과 무관하게 보존한다. 기존 `EmbeddingVector`(슬롯 테이블)와 색인기(`indexer.service.ts`)는 무변경. "보존 ∪ 같은 해시 초안 벡터" 조립으로 복사 기반 보존(pin)을 구현했고 추가 임베딩 호출은 0건이다. 참조 버전 밖 항목은 GC 대상
- 소비자별 소스 선택(C-3): 공개 대화·상담 힌트는 운영 포인터, 시뮬레이터 대화는 대상 선택(초안/스테이징/운영/특정 버전), TC 실행은 대상별 A측 번들·설정·벡터를 `VersionBundleService`/`VersionVectorResolver`로 조립한다. 시뮬레이터 비교와 TC 오버레이는 초안 고정(오버레이+비초안 조합은 400). 2층 캐시(불변 코어 L1 + 합성 L2), 무효화는 기존 `invalidate()` 1곳 재사용
- 신규 권한 `chatbot:deploy`(17→18, ADMIN 기본) — 운영 전환·롤백·모드 켜기/끄기·예약 전환·게이트 설정 전용. `@Public()` 엔드포인트는 8개 그대로 유지(신규 관리자 API 11종은 전부 비공개)
- 게이트: 필수 TC 세트 합격률(WARN/BLOCK, 기본 WARN) — 미리보기 경고는 전부 blocker가 아니라 `acknowledgeWarnings` 확인으로 통과. No.28 예약 배포에 `SWITCH_PROD_VERSION` 동작 신설(실행기·체인 계산 `switch-chain.ts`·전제조건 사유 `SWITCH_BLOCKED`)
- 엔진(`dialogue-engine`) 수정 0건, 위젯·ml-worker 변경 0건. 신규 `ApiErrorCode` 8종, 신규 감사 대상 `ChatbotEnvironment` 1종(액션은 기존 `STATUS_CHANGE`/`UPDATE` 재사용)
- 주요 파일: `apps/api/src/environment/**`(신규 3모듈 — core/serving/env-hooks), `versions/lib/{snapshot-serving,external-refs,environment-protected-versions,context-flows}.ts`, `embedding/text-vector/**`, `embedding/version-vectors/version-vector.resolver.ts`, `deploy-schedules/executors/switch-prod-version.executor.ts`, `deploy-schedules/lib/switch-chain.ts`, `common/events/environment-cache.events.ts`(모듈 경계를 넘는 캐시 무효화 이벤트 버스, R1-M1), `versions/restore/restore-lock.module.ts`(R1-M2, `EnvironmentModeService#enable()`이 복원 잠금을 보게 분리), `apps/web/src/pages/chatbot-detail/environment/**`, `packages/shared-types/src/{environment,bundle-target}.ts`(신규)
- 마이그레이션 2개, 적용 순서: ① `20260925140000_version_tiebreak`(`chatbot_versions.tiebreakHash` 추가만) → ② `20260925150000_environment_separation`(`chatbots.prodVersionId`·`conversation_logs.servedVersionId`·`test_runs` 대상 컬럼 3+인덱스 1 추가, `chatbot_environments`·`environment_switch_logs`·`embedding_text_vectors` 테이블 신설). 둘 다 비파괴(ADD COLUMN/CREATE TABLE/CREATE INDEX만, 기존 행 값 변경 0·백필 0·테이블 재정의 0)
- 배포 절차: `prisma migrate deploy`(① → ② 순서 고정) → API 배포 → 콘솔 배포(위젯 배포 없음, 순서 무관 — 모드 꺼진 챗봇은 모든 응답이 바이트 동일) → 필요한 챗봇에서 환경 모드를 켠다(ADMIN, 콘솔의 챗봇 상세 "환경" 탭 — 켜는 순간은 현재 상태로 두 포인터를 자동 초기화하므로 응답 불변) → 운영 전환·롤백·게이트 설정 권한이 필요한 담당자에게 `chatbot:deploy` 권한 부여를 안내한다
- 롤백 시 주의: 콘솔 → API 순으로 되돌린다. **모드가 켜진 챗봇이 하나라도 있으면 API를 롤백하기 전에 전부 끈다**(구버전 API는 `prodVersionId`를 모르는 채로 항상 초안을 서빙하므로, 끄기를 "운영 유지"로 선택해 초안을 운영 버전에 맞춘 뒤에 롤백해야 사용자 응답이 바뀌지 않는다). 스키마 롤백은 이력·보존 테이블 DROP도 가능하지만 새 컬럼·테이블은 구버전 API에 무해하므로 기본 절차는 "API 롤백까지, 스키마는 유지"다
- 알려진 한계: 초안↔운영 차이는 "스테이징 대비 현재 초안" 요약(`stagingDiff`)만 제공하고 건수 자체를 별도 배지로 보여주는 계약은 없다 · 비율 분할(카나리·A/B)과 서버 간 이관(export/import)은 2차 범위 · 예약 전환(`SWITCH_PROD_VERSION`)의 게이트·차이 요약은 생성 시점에 "지금의 실제 운영" 기준으로 한 번 경고하고, 실행 시점에는 게이트 재평가(통과/차단)만 하며 차이 요약을 다시 보여주지 않는다(체인 중인 예약의 화면 표시값은 참고용) · `EmbeddingTextVectorService`/`VersionVectorResolver` 전용 단위 시험은 없고 통합 시험으로만 커버한다 · 성능(k6) 시나리오는 미자동화 · 그 외 복제 챗봇 체인·사용자 정의 환경·스테이징 외부 미리보기 링크·2인 승인·전환 후 자동 롤백·버전별 통계 비교 화면·설문/API 연결/상담 설정/토픽의 환경 분리·토픽 단위 승격·환경 간 대화 비교는 범위 밖(ADR-0039, 재검토 트리거는 요구사항 §9)
- 테스트 api 2987 / web 682 / widget 133 / engine 182(변경 0) 전부 통과
- 선행 분리 커밋 6b0ce0f(관측 응답 불변 준비): `ChatbotVersion.tiebreakHash`·봉투 `tiebreak` 캡처/저장/파싱, `snapshot-serving.ts`(서빙 역직렬화 순수 함수, 이 커밋에서는 호출부 없이 준비만), `external-refs.ts`(복원 경고 참조 수집 추출), `VersionReadModule` 분리 — 기존 spec 무수정으로 api tsc·jest(versions/embedding/validation/chatbots, 32 suites/345 tests) 통과 확인. `VectorCacheService.textHash` 추가는 설계상 이 선행 커밋 후보였으나 그 필드를 요구하지 않는 기존 `test-run.executor.ts` 경로가 깨져(tsc 컴파일 실패) 본 커밋(②)으로 합쳤다

## 2026-09-26 — 4301714 (선행 분리 커밋 00b11cf·6fad633)

feat: 데이터 거버넌스(No.45) 기능그룹 구현

- 규제산업向 데이터 레지던시·필드 암호화·보존/파기·감사 무결성·열람 감사 기능그룹. 서버 단위 모드(DATA_GOVERNANCE_MODE, 기본 OFF) — 거버넌스 런타임(모드·출구 정책·암호화 켜짐)은 부트스트랩 1곳이 기동 시 1회 설치하는 프로세스 전역 불변 상태이며, 미설치(현행 = 기본값)에서는 관측 동작이 전혀 바뀌지 않는다.
- 레지던시: 기동 시 DATABASE_URL 저장 경로·원격 DB 호스트 허용 목록 검증 + 외부 전송 출구 5클래스(임베딩·RAG·증강 생성기 2종·레거시 API) 코드 레지스트리 + 허용 목록 게이트. 모드 ON에서는 허용 호스트가 비허용 호스트로 리다이렉트해도 따라가지 않는다(redirect:'manual' — 코드리뷰 M-1 반영). 레거시 연결은 저장 시 400(EGRESS_HOST_NOT_ALLOWED), 호출 시 DNS 조회 전 차단(ApiCallOutcome에 EGRESS_BLOCKED 추가, 18→19종).
- 필드 암호화(AES-256-GCM, 봉투 `enc:v1:<keyId>:<base64(iv‖ct‖tag)>`, AAD=테이블:컬럼:행id): 1차 대상은 상담 원문(HandoffMessage.rawText)·상담 메시지(HandoffMessage.text)·설문 자유 텍스트(SurveyAnswer.textValue) 3필드뿐(대화로그·미응답 큐 본문은 2차). 환경변수 키링(DATA_ENCRYPTION_KEYS, 스키마 밖 — env-key.provider.ts 1파일만 읽는다) + 재암호화/백필 잡(FieldCryptoJob) + 키 교체 절차(새 키 앞에 추가 → 재기동 → 데이터 지도에서 옛 키 사용 행 0 확인 → 옛 키 제거 → 재기동).
- 보존기간 텍스트 파기: 대화 원천(대화 로그·미응답 종결 항목·설문 자유 텍스트·상담 메시지)은 행을 지우지 않고 텍스트만 소거(통계·질문 순위 수치 불변, 목록/상세에 "보존기간 경과로 파기됨" 표식). 호출 로그·감사 로그는 보존기간 경과 시 행 삭제. 전역 정책 + 챗봇별 재정의(대화 원천 4종), 단축 시 유예 7일. RetentionJob(PollingLoop, KST 창)이 배치 처리.
- 감사 해시 체인(모드 무관 항상): AuditLogService.record() 1곳이 헤드 CAS 트랜잭션으로 seq·prevHash·rowHash(HMAC 키 있으면 h1:, 없으면 s1: SHA-256)를 계산. POST /audit-logs/verify로 구간 검증(주간 자동 실행도 겸함), 제네시스·보존파기 앵커. 감사 CSV에 seq·rowHash 2열 + 체인 머리/검증 표식 행 2개 추가.
- 열람(VIEW)·내보내기(EXPORT) 감사: EXPORT는 모드 무관 항상(CSV 내보내기 3곳 — 감사로그·설문·검증실행), VIEW는 거버넌스 모드에서만(닫힌 목록 8핸들러 — @AuditView 데코레이터 + 인터셉터, 열람자·대상·KST일당 1건).
- 데이터 지도(GET /governance/map, security:read, 모드 OFF에서도 제공): 저장 위치·출구 5클래스별 허용/차단·필드 암호화 현황(키별 행 수)·보존 현황·감사 체인 상태·위험 지표(v1 평문 헤더 잔존 등)를 실계산으로 보여준다.
- 신규 권한·역할 0종(데이터 지도·보존 조회·파기 이력=security:read, 저장·유예취소=security:write, 체인검증·감사내보내기=audit:read 재사용). @Public() 8개 그대로 유지. 신규 관리자 엔드포인트 12개(GovernanceController·ChatbotRetentionController). PII_MASK_MODE=PARTIAL|FULL 옵션 추가(기본 PARTIAL=바이트 동일).
- 엔진(dialogue-engine)·위젯·ml-worker 변경 0건. GPU 1 유지(AES-GCM·SHA-256/HMAC·배치 UPDATE/DELETE뿐).
- PM 결정 요점(P-1~P-12, 전부 추천안 채택): P-1 레지던시=기동 시 저장경로 검증+출구 5클래스 허용목록+데이터 지도(물리 리전·백업 위치는 인프라 책임) · P-2 1차 필드 암호화 3필드뿐(대화로그·미응답 큐는 2차) · P-3 보존기간 경과 대화 원천은 텍스트만 소거(행·통계 보존, LOG_DELETION_ALLOWLIST 빈 배열 유지) · P-4 신규 권한 0(완화 방향 변경은 환경변수로만) · P-5 보존 하한 대화7일·감사365일(전역+챗봇 재정의, 단축 유예 7일) · P-6 감사 체인은 HMAC+앵커+검증, 모드 무관 항상 · P-7 키=환경변수 키링+재암호화 잡(KMS는 2차) · P-8 켤 때 백필 잡, 끌 때는 환경변수(기존 암호문은 계속 읽힘) · P-9 PII_MASK_MODE 옵션(기본 PARTIAL) · P-10 EXPORT 항상·VIEW는 모드 ON에서만(열람자·리소스·KST일당 1건) · P-11 대화로그 본문 암호화·KMS·정보주체 파기·SIEM·감사 역할·2인 승인·멀티테넌시는 2차 · P-12 데이터 지도는 모드 OFF에서도 조회 가능, GPU 1 유지·구축형 적합·구독형 일부 적합.
- 마이그레이션 1개: `20260926120000_data_governance`(AuditLog 체인 3컬럼 seq·prevHash·rowHash 및 유일 인덱스 · ConversationLog/UnansweredQuestion/SurveyAnswer/HandoffMessage에 textPurgedAt 4컬럼 + 탐색 인덱스 3 · RetentionPolicy·RetentionRun·AuditChainHead·AuditChainAnchor·GovernanceJobState 신규 5테이블 · Chatbot ↔ RetentionPolicy 역참조). 전부 ADD COLUMN/CREATE TABLE/CREATE INDEX만이라 기존 부분 유니크 인덱스 4개에 영향 없음.
- 배포 절차: ① `prisma migrate deploy` → ② API 배포(본 그룹 커밋 3개 전부) → ③ (선택) 거버넌스 모드를 켜려면 `DATA_GOVERNANCE_MODE=ON` + `DATA_RESIDENCY_ALLOWED_DIRS`/`DATA_RESIDENCY_ALLOWED_DB_HOSTS` + `DATA_EGRESS_ALLOWED_HOSTS`(레거시 연결·RAG_BASE_URL 등 실제 사용 호스트를 미리 등록 — 목록 밖이면 기동 실패) 설정 후 재기동 → ④ 필드 암호화까지 켜려면 `DATA_ENCRYPTION_ENABLED=true` + `DATA_ENCRYPTION_KEYS="k1:<base64 32바이트>"`(`openssl rand -base64 32`로 생성, zod 스키마 밖이라 `.env`에만 둔다) 설정 후 재기동 → ⑤ 재암호화/백필 잡(DATA_REENCRYPT_JOB_ENABLED 기본 true)이 기존 평문 행을 순차 암호화한다 — 데이터 지도의 "평문 행 0" 확인까지 기다린다. 전부 선택이며 하나도 설정하지 않으면 모드 OFF·보존 무기한·암호화 없음·PARTIAL 마스킹으로 현행과 동일하게 동작한다(감사 체인만 예외로 항상 켜져 있어 부팅 시 헤드 행을 만든다).
- **경고**: 필드 암호화(`DATA_ENCRYPTION_ENABLED=true`)를 켠 설치는 API를 이 그룹 이전 버전으로 롤백하지 않는다. 구버전은 암호문(`enc:v1:...`)을 복호화하지 못하고 평문처럼 그대로 표시해 상담 원문·메시지·설문 자유 텍스트 화면이 깨진다. 롤백이 꼭 필요하면 먼저 `DATA_ENCRYPTION_ENABLED=false`로 끄고 재암호화 잡이 없는 상태에서 절차를 검토한다(기존 암호문은 남아있으므로 완전한 원복은 아니다).
- 기본 상태(모드 OFF, 암호화 OFF)에서도 달라지는 점 3가지(감사 체인은 모드 무관 항상 켜짐): ① CSV 내보내기(감사로그·설문 응답/요약·검증 실행 결과)마다 EXPORT 감사 1건이 남는다 ② 감사 로그 CSV 내보내기에 `seq`·`rowHash` 2열이 추가되고 파일 끝에 `#CHAIN_HEAD`·`#CHAIN_VERIFY` 표식 행 2개가 붙는다(열 수는 동일하게 유지) ③ 감사 로그 상세 응답에 `chain?` 필드(seq·prevHash·rowHash·method)가 값이 있을 때만 추가된다.
- 보존 하한 기본값(`RETENTION_MIN_DAYS_CONVERSATION=7`·`RETENTION_MIN_DAYS_AUDIT=365`)은 법무 확인 전 잠정값이다 — 감사 하한을 365일 미만으로 낮추면 기동 시 경고만 하고 허용한다(EX-DG-17).
- 테스트 apps/api jest 212 suites/3226 tests(9건은 본 그룹과 무관한 기존 feedback/message-feedback.service.spec.ts 실패 — clean HEAD에서도 재현), apps/web vitest 147 files/758 tests, apps/widget vitest 18 files/133 tests, packages/dialogue-engine jest 15 suites/182 tests(변경 0건) 전부 통과.
- 커밋 분리: ① 00b11cf(기반 — 출구 가드·필드 봉투·거버넌스 런타임, 관측 응답 불변·기존 시험 무수정 통과) → ② 6fad633(감사로그 해시 체인·열람/내보내기 감사, 의도된 기대값 변경 X-1(AuditAction 14→16)뿐) → ③ 4301714(거버넌스 본체 — 부트스트랩·정책·잡·데이터 지도·콘솔·문서, 의도된 기대값 변경 X-2~X-8).
- 알려진 한계: PUT 보존 정책 응답의 `appliedNow`/`pendingKinds` 필드 미구현 · `env-key.provider.ts` 전용 단위 시험 부재(통합 시험으로만 커버) · 부하(k6) 시나리오 미자동화 · 기존 간헐 실패 시험 2종(version-history-reindex, topic-system 통합 시험 — 전체 스위트 병렬 실행 시 드물게 실패, 본 그룹 범위 밖) · 2차 범위(대화로그·미응답 큐 본문 암호화(블라인드 인덱스)·KMS/HSM/Vault·정보주체 파기 요청·SIEM 연동·감사 전용 역할·2인 승인·멀티테넌시).

## 2026-09-26 — 169be3f (선행 분리 커밋 8b874d3·78c70cf·1c0e3e5)

feat: 업무 자동화 워크플로우(No.41) 기능그룹 구현

- 대화그래프에 "업무 요청 보내기" 아웃풋(`WORKFLOW`)을 신설한다 — 폼 슬롯·상수 바인딩(No.26 `ApiBindingSchema` 그대로 재사용), 사용자에게 보이지 않는 비종결 아웃풋. 엔진은 대화를 멈추지 않고 결과 선택 필드 `workflowEvents?`에 "보낼 것"만 싣는다(`surveyEvents` 선례 방식, 재조립 경로 `resumeAfterApiCall` 등에서도 필드 소실 없음). 챗봇별 이벤트 구독 5종(상담 시작·종료·설문 완료·부정 평가·연속 미응답 N회)은 원천 서비스(대화로그·상담·설문·평가)가 커밋 후 순수 포트(`WORKFLOW_EVENT_SINK`)로 fire-and-forget 발행한다.
- 범용 아웃바운드 웹훅 1종: HMAC-SHA256 서명(`t=,v1=`, `X-Chatbot-Delivery`), 멱등키(`dedupeKey`), 지수 백오프 재시도, "비밀 주소" 옵션(`urlSecretRef`). 발송 결과는 DB 발송함(`WorkflowRun` = 발송함 겸 실행 이력) + `PollingLoop` + 행 선점(CAS)으로 최소 1회 보장(멀티 인스턴스 1회 발송). 일시 정지 중 신규·대기 요청은 보류(HELD)되고 재개 시 발송, 24시간 초과는 만료(EXPIRED). 실패 본문은 7일 보관 후 소거하며 그 안에서만 재발송 가능하다.
- No.45 출구 게이트에 6번째 클래스 `WORKFLOW_WEBHOOK`을 편입한다. No.26의 전송·DNS·IP 정책(SSRF 방어) 부품을 이동 없이 두 번째 DI 토큰으로 등록해 그대로 재사용하고(SSRF 코드 1벌 유지), 사설 대역 허용은 레거시와 별도인 `WORKFLOW_PRIVATE_ALLOWLIST`로 관리한다. 공유 전송은 `node:http(s).request` 기반이라 리다이렉트를 원래 따라가지 않는다(3xx = 영구 실패, 모드 무관).
- 재시도용 발송함 본문(`WorkflowRun.payload`)은 `EncryptedFieldId` 4번째 대상 `WORKFLOW_PAYLOAD`로 암호화하고(성공 즉시·실패 7일 뒤 소거), 보존/파기(No.45 `governance-data.writer.ts`·`retention-policy.service.ts`)에 종단 편입한다.
- 신규 권한 0종(대상 = `security:write`, 구독·재발송 = `chatbot:write`, 노드 = `dialogue:write` — 전부 기존 권한 재사용), `@Public()` 엔드포인트 8개 그대로 유지(신규 관리자 API는 전부 비공개).
- 테스트: apps/api jest 235 suites/3522 tests, packages/dialogue-engine jest 17 suites/200 tests(변경 0건), apps/web vitest 164 files/829 tests, apps/widget vitest 18 files/133 tests 전부 통과.

### PM 결정 요점(P-1~P-12, 전부 추천안 채택)

P-1 트리거 = 대화그래프 "업무 요청 보내기" 노드 + 이벤트 구독(닫힌 목록 5종) · P-2 엔진에 새 출력 종류(`surveyEvents` 방식), 기존 엔진 시험 무수정 통과, 재조립 경로 필드 소실 금지 · P-3 범용 아웃바운드 웹훅 1종·HMAC 서명·재시도·멱등키·"비밀 주소" 옵션 · P-4 비동기 발송만(대화는 결과를 기다리지 않음), 결과는 콘솔 이력, `@Public()` 8 유지 · P-5 이벤트 5종(상담 시작·종료·설문 완료·부정 평가·연속 미응답 N회) · P-6 페이로드 = 메타데이터+`sessionRef`+마스킹된 폼 값(대상별 원문 허용은 확인 문구+감사), 대화 본문 0, 재시도 본문은 성공 즉시·실패 7일 뒤 소거 · P-7 비밀 = `WORKFLOW_SECRET__<REF>` 환경변수(DB 값 0) · P-8 신규 권한 0 · P-9 일시 정지 중 보류→재개 시 발송, 24시간 초과 만료 · P-10 노드는 스냅샷 자동 포함, 대상·구독은 저장 즉시 운영 반영(환경 밖) · P-11 2차 범위 = 콜백·대화 표시·프리셋·메일·운영 이벤트·대화 종료·발췌 첨부 · P-12 GPU 1(카탈로그 2 → 하향, JSON 조립·HMAC·HTTP 송신·DB 발송함 읽기/쓰기뿐, 모델·학습·추론·임베딩 0), 구축형·구독형 전부 적합.

### 수용 편차(요구사항 대비 해석)

- **R-5**: FR-WF3-5 "API 고정 문구 턴 제외"는 No.24 `evaluateSessionAlert()`의 기존 판정(API 고정 문구 턴을 미응답으로 셈, ADR-0036 결정)과 모순되어 같은 함수를 재사용해 **산입**했다 — 상담 콘솔 모니터링 화면과 웹훅 발행 숫자를 일치시키기 위함이다.
- **R-6**: FR-WF5-3 "대상당 동시 SENDING ≤2(인스턴스 무관)"는 DB 계수 기반으로 구현했으나 tick 간 경합으로 정확한 상한이 아니라 **근사**다(K-3).
- **R-8**: FR-WF1-8 "대상 삭제 409는 스냅샷 참조까지 포함"은 스냅샷 본문 테이블 참조 파일 봉인(V-7)을 깨뜨려 No.26 선례대로 **초안 노드 + 구독만** 검사하고, 운영/스테이징 버전 참조는 경고만 띄우고 실행 시 건너뛴다.
- **K-8**: FR-WF7-6 "챗봇 목록·대시보드 확인 필요 배지"는 챗봇 목록 API 바이트 불변(FR-0-172급) 원칙을 지키기 위해 1차에서 구현하지 않았다 — 업무 자동화 메뉴 배지·챗봇 탭 배지로 대체한다.

### 마이그레이션

`20260926180000_workflow_automation` 1개 — 전부 `CREATE`(신규 3테이블 `workflow_targets`·`workflow_subscriptions`·`workflow_runs`, `Chatbot` 역참조는 컬럼 0). 기존 테이블 재정의·`ALTER TABLE`·백필 0건. 원시 부분 유니크 인덱스 4종(No.19/28/24 그룹)에 영향 없음.

### 배포 절차

① `prisma migrate deploy`(테이블 신설뿐 — API 중지 불필요) → ② API 배포 → ③ 콘솔 배포(순서 무관) → ④ (선택) 발송 기능을 쓰려면 `WORKFLOW_ENABLED=true`(기본값)·발송 루프를 돌릴 인스턴스에 `WORKFLOW_DISPATCH_ENABLED=true`(기본값, 시험 환경만 `false`) 확인 → ⑤ 발송 대상 등록 시 비밀은 `WORKFLOW_SECRET__<REF>` 환경변수로만 넣는다(DB에는 참조 이름만 저장) → ⑥ 거버넌스 모드(No.45 `DATA_GOVERNANCE_MODE=ON`)를 켠 설치는 대상의 `baseUrl` 호스트를 기존 `DATA_EGRESS_ALLOWED_HOSTS`(No.45 출구 허용목록)에 미리 등록해야 저장·발송이 막히지 않는다 — `WORKFLOW_WEBHOOK` 전용 별도 허용목록은 없다(사설 대역만 `WORKFLOW_PRIVATE_ALLOWLIST`로 별도 관리). 전부 선택이며 대상을 하나도 등록하지 않으면 기존 설치와 관측 동작이 완전히 동일하다(FR-0-172).

### 대화 엔진 변경 공지

이 그룹이 엔진(`dialogue-engine`) 변경을 세 번째 "의도된 예외"(No.26 API_CONDITION → No.27 SURVEY → No.41 WORKFLOW)로 공식화하면서, 엔진 미커밋 diff를 `git status`로 검사하던 봉인(E-5, `environment-sealing.spec.ts`)이 커밋 전·부분 스테이징 구간에서 항상 실패하는 구조적 결함이 되어 **골든 스냅샷 방식(X-5)으로 재설계**했다. 새 검사는 git과 무관하게 `packages/dialogue-engine/src` 최상위 파일 목록과 빌드 산출물의 실제 내보내기 심볼 집합을 승인된 스냅샷(파일 21개·심볼 64개)과 비교한다. **앞으로 엔진 파일 구성이나 공개 심볼을 바꿀 때는 이 골든 스냅샷을 함께 갱신해야 한다** — 잊으면 무관한 변경에서도 이 시험이 실패한다.

### 알려진 한계

- AC/EX 약 15개가 자동시험으로 아직 커버되지 않았다(성능(k6) 시나리오, 일부 화면 계약 세부 문구 등).
- 서비스 단위 시험이 없는 곳: `workflow-secret.resolver.ts`(비밀 리졸버), `workflow-test-send.service.ts`(테스트 발송), `workflow-runs-query.service.ts`(이력 조회), `workflow-http.sender.ts`(HTTP 발송기), `workflow-catalog.service.ts`(카탈로그) — 전부 통합 시험으로만 커버한다.
- **I-4**: 구독 이벤트 웹훅 봉투의 `chatbot.name`은 캐시 TTL 30초 규약을 그대로 따른다 — 챗봇 이름 변경 직후 최대 30초 동안 구 이름이 실릴 수 있다(전용 무효화 지점을 추가하지 않기로 함, system-architect 재검토 대상).
- **I-5**: `WorkflowTargetsService.resume()`·`WorkflowSubscriptionsService.resume()`은 `CLOCK` 토큰을 주입받지 않고 실제 벽시계(`new Date()`)를 쓴다(정리 루프만 주입 시계 사용) — 시험은 `Date.now()` 기준 상대 시각 픽스처로 이를 반영했다.
- 범위 밖 간헐 실패 2건(본 그룹 이전부터 있던 기존 결함, 전체 스위트 병렬 실행 시에만 드물게 재현): legacy-api 통합 시험의 로그 레이스, `version-history-reindex` 통합 시험(AC-H3-7). **후자는 우선순위 상향을 권고한다.**
