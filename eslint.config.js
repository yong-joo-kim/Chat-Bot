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
  {
    // ADR-0012 — apps/widget은 경량 번들(gzip 100KB 이내)이 목표라 `@chat-bot/shared-types`
    // 루트의 값(value) import(zod 스키마 등)를 금지한다. 서브패스(`/output-view`, `/contrast`)는
    // 트리셰이킹 가능한 순수 함수만 노출하므로 허용하고, `import type`도 번들에 남지 않으므로 허용한다.
    files: ['apps/widget/**/*.ts', 'apps/widget/**/*.tsx'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@chat-bot/shared-types',
              message:
                'apps/widget에서는 @chat-bot/shared-types 루트의 값 import가 금지됩니다(ADR-0012, 번들 크기). ' +
                'import type만 사용하거나 서브패스(예: @chat-bot/shared-types/output-view)를 사용하세요.',
              allowTypeImports: true,
            },
          ],
        },
      ],
    },
  },
);
