import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    // pnpm 워크스페이스 심볼릭 링크로 연결된 @chat-bot/shared-types(CommonJS 빌드 산출물)를
    // 정상적으로 ESM 인터롭 처리하기 위해 node_modules 밖 실제 경로도 포함한다.
    commonjsOptions: {
      include: [/node_modules/, /packages[\\/]shared-types/],
    },
  },
  optimizeDeps: {
    include: ['@chat-bot/shared-types'],
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    globals: false,
    // 주의: restoreMocks/clearMocks를 켜면 모듈 스코프에 한 번만 설정한 vi.fn().mockResolvedValue(...)가
    // 매 테스트 전에 초기화되어 버린다(이 저장소의 vi.mock 픽스처는 대부분 모듈 스코프 설정 방식을 사용).
    // 각 spec 파일이 필요할 때 beforeEach에서 명시적으로 mockReset()/mockResolvedValue(...)를 호출한다.
  },
});
