import { bootHarness, startFakeRag } from './helpers/ai-guardrails.harness';
import type { FakeRag, Harness } from './helpers/ai-guardrails.harness';
import { runParityScript } from './helpers/ai-guardrails-parity';
import { PARITY_GOLDEN } from './helpers/ai-guardrails-parity.golden';

/**
 * 가드레일(No.36) 바이트 동일(AC-AG1-1 · AC-AG1-6) — 규칙 0 · 기본 가림 설정 · 승인 정책 꺼짐 상태에서 공개 대화·보류 폴링 응답과
 * 저장 마스킹 결과가 **도입 전과 같다**. 이 파일은 기본 설정(`GUARDRAILS_ENABLED` 기본 true)에서, 짝 파일
 * `ai-guardrails-byte-parity-off.integration.spec.ts`는 `GUARDRAILS_ENABLED=false`에서 **같은 골든**과 비교한다
 * (`ConfigModule` 스냅샷은 프로세스 1회라 설정별로 파일을 나눈다 — 데이터 거버넌스 OFF/ON 선례).
 */
describe('가드레일(No.36) 바이트 동일 — 기본 설정(켜짐 · 규칙 0)', () => {
  let h: Harness;
  let rag: FakeRag;

  beforeAll(async () => {
    rag = await startFakeRag();
    h = await bootHarness({ tmpPrefix: 'ai-guardrails-parity-', env: { RAG_BASE_URL: rag.url, RAG_STATUS_CACHE_MS: '600000' } });
  }, 90_000);

  afterAll(async () => {
    await h?.close();
    await rag?.close();
  }, 20_000);

  it('공개 대화 · 보류 폴링 · 저장 userMessage/botResponse가 골든과 같다', async () => {
    const records = await runParityScript(h, rag);
    expect(records).toEqual(PARITY_GOLDEN);
  });
});
