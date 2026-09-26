/** @type {import('jest').Config} */
module.exports = {
  rootDir: 'src',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/../jest.isolate-env.js'],
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  moduleFileExtensions: ['js', 'json', 'ts'],
  collectCoverageFrom: ['**/*.(t|j)s'],
  coverageDirectory: '../coverage',
  // [test-automation 2026-09-26 — No.41 자동시험] 전체 스위트를 병렬로 실행하면 여러 워커가 동시에
  // 실제 Nest 앱(HTTP 서버 + SQLite)을 띄우는 통합 시험의 CPU 경합으로 기본 5000ms를 넘겨 간헐
  // 실패하는 사례가 여러 그룹(chatbot-operations·legacy-api-integration·environment-separation·
  // integrated-stats·scheduled-deploy·workflow-automation 등)에서 재현됐다 — 실패한 파일을 단독
  // 실행하면 항상 통과해, 로직 결함이 아니라 병렬 부하 상황의 여유 부족으로 판단했다. 제품 코드는
  // 건드리지 않고 기본 타임아웃만 넉넉히 늘린다(진짜 무한 대기는 여전히 20초 뒤 실패로 잡힌다).
  testTimeout: 20000,
  // [test-automation 2026-09-27 — No.46 자동시험, 간헐 실패 근본 조사] `version-history-reindex`
  // (AC-H3-7) · `omnichannel-inbox-query-count` · `learning-augmentation`(노드 생성 500/타임아웃)
  // 3건 + 조사 중 추가로 관측된 `integrated-stats`(ECONNRESET) · `survey-management`(AC-SV3-1)까지
  // 총 5개 파일이 **매번 다른 조합으로** 전체 스위트 병렬 실행에서만 흔들렸다 — 12코어 머신에서
  // 263개 스위트 중 다수(실제 Nest 앱+SQLite를 띄우는 통합 시험)를 기본 워커 수(os.cpus().length-1
  // ≈ 11개)로 동시에 돌릴 때 생기는 시스템 전반의 CPU 경합이 근본 배경이라고 보았다. 그러나
  // 워커 수를 33%(4개)까지 낮춰도 `version-history-reindex`가 여전히 흔들리는 것을 확인한 뒤
  // (원인: 개별 파일의 절대 실행 시간이 늘어날수록 그 파일 내부의 `isRunning()` 폴링 자체가 더 긴
  // 지연을 견뎌야 해서, 워커를 줄이는 것이 이 특정 시험에는 도움이 되지 않았다 — 상세는
  // `docs/04-test/시험데이터.md` No.46 절), **워커 수 하향만으로는 근본 해결이 아니라고 결론**짓고
  // 되돌렸다: 대신 각 파일의 시험 코드를 "인메모리 플래그를 일정 시간 관찰"하는 방식에서 "제품이
  // 실제로 만든 결과(DB 행·응답 필드)를 직접 확인"하는 방식으로 고쳐 타이밍 가정 자체를 제거했다
  // (`version-history-reindex`는 `embeddingVector.textHash` 직접 폴링, 나머지는 각 파일 상단 주석
  // 참고). 워커 수는 50%로만 낮춰 전체 실행 시간과 경합 완화의 균형을 잡는다(실측치는
  // `docs/04-test/자동시험_전략.md` No.46 절 참고). 제품 코드는 `dialog-nodes.service.ts` 1곳만
  // 고쳤다(Prisma 기본 트랜잭션 타임아웃 5000ms가 CPU 경합 환경에는 과소하다는 것을 실제로
  // 재현·확인한 뒤 30000ms로 상향 — `versions` 모듈 기존 선례와 정렬).
  maxWorkers: '50%',
};
