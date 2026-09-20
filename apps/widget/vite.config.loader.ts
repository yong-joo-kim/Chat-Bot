import { defineConfig } from 'vite';

/**
 * 임베드 로더 빌드(`dist/widget.js`, 파일명 고정·해시 없음 — 기존 임베드 스니펫 계약 FR-W-2).
 * IIFE, CSS는 `styles.ts` 문자열로 인라인(별도 CSS 요청 0건). `emptyOutDir:false`로 전체화면
 * 빌드 산출물(`vite.config.ts`가 먼저 만든 `dist/index.html` 등)을 지우지 않는다(ADR-0012 §9.2).
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'es2020',
    // pnpm 워크스페이스 심볼릭 링크로 연결된 @chat-bot/shared-types(CommonJS 빌드 산출물)를 정상적으로
    // ESM 인터롭 처리하기 위해 node_modules 밖 실제 경로도 포함한다(apps/web/vite.config.ts와 동일 이유).
    commonjsOptions: {
      include: [/node_modules/, /packages[\\/]shared-types/],
    },
    rollupOptions: {
      input: 'src/loader.ts',
      output: {
        format: 'iife',
        entryFileNames: 'widget.js',
      },
    },
  },
});
