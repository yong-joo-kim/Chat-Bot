import { defineConfig } from 'vitest/config';

/**
 * 전체화면 빌드(`/c/:slug`, FR-W-3) + `vitest` 테스트 러너 설정. `index.html` → `src/fullscreen.ts`.
 * 임베드 로더(`widget.js`)는 별도 `vite.config.loader.ts`(IIFE, 파일명 고정)로 빌드한다(ADR-0012 §9.2).
 */
export default defineConfig({
  server: {
    port: 5174,
  },
  preview: {
    port: 5174,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    // pnpm 워크스페이스 심볼릭 링크로 연결된 @chat-bot/shared-types(CommonJS 빌드 산출물)를 정상적으로
    // ESM 인터롭 처리하기 위해 node_modules 밖 실제 경로도 포함한다(apps/web/vite.config.ts와 동일 이유).
    commonjsOptions: {
      include: [/node_modules/, /packages[\\/]shared-types/],
    },
  },
  optimizeDeps: {
    include: ['@chat-bot/shared-types/output-view', '@chat-bot/shared-types/contrast'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    // `CSS.escape`(jsdom 미구현, `pending-indicator.ts`가 사용) 등 jsdom 환경 격차를 메우는
    // 테스트 전용 폴리필 — 프로덕션 번들에는 포함되지 않는다(`src/test/css-escape-polyfill.ts`).
    setupFiles: ['src/test/css-escape-polyfill.ts'],
  },
});
