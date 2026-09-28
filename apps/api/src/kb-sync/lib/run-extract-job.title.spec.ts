import { runExtractJob } from './run-extract-job';

/**
 * [pass 10 · RG-25] HTML `<title>`도 본문과 같은 마스킹 규칙을 받고(PII 마스킹이 켜진 소스), 마스킹 여부와 무관하게 200자로 자른다.
 * 자름은 마스킹 뒤에 한다 — 자른 조각에 전화번호 앞자리 같은 개인정보 일부가 남지 않게.
 */
const BODY = '이 문서는 지식베이스 동기화 시험용 본문입니다. '.repeat(12);
const doc = (title: string): string => `<html><head><title>${title}</title></head><body><main><p>${BODY}</p></main></body></html>`;
const req = (title: string, piiMask: boolean, mode: 'PARTIAL' | 'FULL' = 'PARTIAL') => ({ kind: 'HTML' as const, html: doc(title), noisePatterns: [], piiMask, piiMaskMode: mode });

describe('runExtractJob(HTML) — 제목 마스킹·절단(RG-25)', () => {
  it('★ 제목의 전화번호·이메일이 마스킹된다(piiMask = true)', async () => {
    const r = await runExtractJob(req('문의 010-1234-5678 / hong@example.com', true));
    expect(r.title).not.toContain('1234');
    expect(r.title).not.toContain('hong@example.com');
    expect(r.title).toContain('010-****-5678');
  });

  it('제목 마스킹 건수가 piiMaskedCount에 합산된다(본문 0건이어도)', async () => {
    const r = await runExtractJob(req('문의 010-1234-5678', true));
    expect(r.piiMaskedCount).toBe(1);
  });

  it('FULL 모드면 제목의 전화번호·이메일도 전량 치환된다', async () => {
    const r = await runExtractJob(req('문의 010-1234-5678 hong@example.com', true, 'FULL'));
    expect(r.title).not.toMatch(/5678|hong|example/);
  });

  it('★ 200자를 넘는 제목은 200자로 잘린다', async () => {
    const r = await runExtractJob(req('가'.repeat(300), true));
    expect(Array.from(r.title ?? '').length).toBe(200);
  });

  it('★ 마스킹 뒤에 자른다 — 경계에 걸친 전화번호 앞자리가 원문으로 남지 않는다', async () => {
    // 원문 기준 195자 위치에서 시작하는 번호. 먼저 자르면 "010-1" 같은 조각이 원문 그대로 남는다.
    const r = await runExtractJob(req(`${'가'.repeat(195)}010-1234-5678 뒷부분`, true));
    expect(r.title).not.toMatch(/010-\d/);
    expect(r.title).not.toContain('1234');
    expect(Array.from(r.title ?? '').length).toBeLessThanOrEqual(200);
  });

  it('piiMask = false 소스는 제목을 마스킹하지 않지만(본문 규칙과 일관) 200자로는 자른다', async () => {
    const short = await runExtractJob(req('문의 010-1234-5678', false));
    expect(short.title).toBe('문의 010-1234-5678');
    expect(short.piiMaskedCount).toBe(0);
    const long = await runExtractJob(req('가'.repeat(300), false));
    expect(Array.from(long.title ?? '').length).toBe(200);
  });

  it('제목이 없으면 null 그대로다', async () => {
    const r = await runExtractJob({ kind: 'HTML', html: `<html><body><main><p>${BODY}</p></main></body></html>`, noisePatterns: [], piiMask: true, piiMaskMode: 'PARTIAL' });
    expect(r.title).toBeNull();
  });

  it('서로게이트 쌍(이모지)을 반으로 자르지 않는다', async () => {
    const r = await runExtractJob(req(`${'가'.repeat(199)}😀😀`, false));
    expect(Array.from(r.title ?? '').length).toBe(200);
    expect(r.title).not.toMatch(/[\uD800-\uDBFF]$/);
  });
});
