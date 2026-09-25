import { decideDisable } from './disable-plan';

describe('decideDisable — §5.4', () => {
  it('PROMOTE_DRAFT는 해시가 달라도 항상 OK다', () => {
    expect(decideDisable({ mode: 'PROMOTE_DRAFT', draftContentHash: 'a', prodContentHash: 'b' })).toBe('OK');
  });

  it('KEEP_PROD인데 초안 해시 = 운영 해시면 OK다', () => {
    expect(decideDisable({ mode: 'KEEP_PROD', draftContentHash: 'a', prodContentHash: 'a' })).toBe('OK');
  });

  it('KEEP_PROD인데 초안 해시 ≠ 운영 해시면 NEED_RESTORE다(409 ENV_DRAFT_NOT_RESTORED)', () => {
    expect(decideDisable({ mode: 'KEEP_PROD', draftContentHash: 'a', prodContentHash: 'b' })).toBe('NEED_RESTORE');
  });
});
