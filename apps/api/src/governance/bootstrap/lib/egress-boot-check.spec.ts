import { checkEgressBootUrls } from './egress-boot-check';
import { AUGMENT_GEMINI_DEFAULT_BASE_URL } from '../../../common/egress/egress-registry';

/**
 * ★ 출구 기동 검사(AC-DG2-2) — 지금까지 이 순수 함수를 직접 겨냥한 단위 시험이 없었다
 * (`governance-bootstrap.service.spec.ts`는 M-2 포트 매칭만 다룬다). test-automation
 * 보강(2026-09-26).
 */
describe('checkEgressBootUrls(No.45 §6.4) — 출구 기동 검사', () => {
  const allow = (allowed: string[]) => (url: string): boolean => allowed.includes(new URL(url).hostname);

  it('임베딩·RAG URL이 미설정이면 검사 대상에서 빠진다', () => {
    const result = checkEgressBootUrls({ augmentationProvider: 'none' }, allow([]));
    expect(result.ok).toBe(true);
  });

  it('임베딩 URL이 허용 목록 밖이면 기동 실패다', () => {
    const result = checkEgressBootUrls({ embeddingBaseUrl: 'http://blocked.example.com', augmentationProvider: 'none' }, allow(['ml-worker.internal']));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/임베딩/);
  });

  it('RAG URL이 허용 목록 밖이면 기동 실패다', () => {
    const result = checkEgressBootUrls({ ragBaseUrl: 'http://blocked.example.com', augmentationProvider: 'none' }, allow(['ml-worker.internal']));
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/RAG/);
  });

  it('AC-DG2-2: AUGMENTATION_PROVIDER=gemini이고 API 키가 있는데 허용 목록에 Gemini 호스트가 없으면 기동 실패다', () => {
    const result = checkEgressBootUrls(
      { augmentationProvider: 'gemini', augmentationGeminiApiKey: 'test-key' },
      allow(['ml-worker.internal']),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/Gemini/);
  });

  it('AC-DG2-2: 허용 목록에 Gemini 기본 호스트를 추가하면 기동에 성공한다', () => {
    const geminiHost = new URL(AUGMENT_GEMINI_DEFAULT_BASE_URL).hostname;
    const result = checkEgressBootUrls(
      { augmentationProvider: 'gemini', augmentationGeminiApiKey: 'test-key' },
      allow([geminiHost]),
    );
    expect(result.ok).toBe(true);
  });

  it('Gemini API 키가 없으면(증강 실질 미사용) 허용 목록에 없어도 통과한다', () => {
    const result = checkEgressBootUrls({ augmentationProvider: 'gemini' }, allow([]));
    expect(result.ok).toBe(true);
  });

  it('AUGMENTATION_PROVIDER=local이고 로컬 URL이 있는데 허용 목록 밖이면 기동 실패다', () => {
    const result = checkEgressBootUrls(
      { augmentationProvider: 'local', augmentationLocalBaseUrl: 'http://local-gen.example.com' },
      allow(['ml-worker.internal']),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/로컬/);
  });

  it('여러 출구가 동시에 설정되면 앞선 것부터 순서대로 검사해 첫 실패 사유를 반환한다', () => {
    const result = checkEgressBootUrls(
      { embeddingBaseUrl: 'http://blocked-embed.example.com', ragBaseUrl: 'http://blocked-rag.example.com', augmentationProvider: 'none' },
      allow([]),
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/임베딩/); // 임베딩이 검사 목록의 첫 항목
  });
});
