// Chat Bot — 최소 ESLint 구성 (Auto QA 컨벤션 재사용)
// 범위: 타입 인지(type-aware) 규칙은 모노레포 전역 tsconfig 참조 설정이 필요해 비용이 크므로
//       비-타입체크 recommended 규칙셋만 적용한다(최소 구성). 필요 시 후속 Phase에서 확장.
const tseslint = require('typescript-eslint');
const reactHooks = require('eslint-plugin-react-hooks');

module.exports = tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.d.ts',
      '**/*.js',
      'apps/api/prisma/**',
      'docs/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    rules: {
      // Nest 데코레이터/DI 패턴 및 zod 파싱 결과 사용 시 any가 불가피한 경우가 있어 경고로 완화
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**/*.tsx', 'apps/web/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      'react-hooks/rules-of-hooks': 'error',
    },
  },
);
