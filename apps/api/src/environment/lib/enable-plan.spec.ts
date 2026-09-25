import { decideEnvInitVersion } from './enable-plan';

describe('decideEnvInitVersion — §5.3 발견 제약 ③', () => {
  it('latest가 없으면 CREATE다', () => {
    expect(decideEnvInitVersion({ latest: null, captured: { contentHash: 'h1', tiebreakHash: 't1' } })).toEqual({ action: 'CREATE' });
  });

  it('contentHash·tiebreakHash가 모두 같으면 REUSE다', () => {
    const latest = { id: 'v1', versionNo: 3, contentHash: 'h1', tiebreakHash: 't1' };
    expect(decideEnvInitVersion({ latest, captured: { contentHash: 'h1', tiebreakHash: 't1' } })).toEqual({ action: 'REUSE', versionId: 'v1', versionNo: 3 });
  });

  it('contentHash만 같고 tiebreakHash가 다르면 CREATE다(동점 승자가 다를 수 있다)', () => {
    const latest = { id: 'v1', versionNo: 3, contentHash: 'h1', tiebreakHash: 't1' };
    expect(decideEnvInitVersion({ latest, captured: { contentHash: 'h1', tiebreakHash: 't2' } })).toEqual({ action: 'CREATE' });
  });

  it('★ latest.tiebreakHash가 null(보조 필드 없는 과거 버전)이면 재사용하지 않는다', () => {
    const latest = { id: 'v1', versionNo: 3, contentHash: 'h1', tiebreakHash: null };
    expect(decideEnvInitVersion({ latest, captured: { contentHash: 'h1', tiebreakHash: 't1' } })).toEqual({ action: 'CREATE' });
  });

  it('contentHash가 다르면 CREATE다', () => {
    const latest = { id: 'v1', versionNo: 3, contentHash: 'h1', tiebreakHash: 't1' };
    expect(decideEnvInitVersion({ latest, captured: { contentHash: 'h2', tiebreakHash: 't1' } })).toEqual({ action: 'CREATE' });
  });
});
