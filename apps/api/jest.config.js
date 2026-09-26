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
};
