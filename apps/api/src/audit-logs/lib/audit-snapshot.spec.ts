import { buildSnapshot, serializeSnapshot } from './audit-snapshot';

describe('buildSnapshot — FR-13-11', () => {
  it('화이트리스트에 없는 필드(예: passwordHash)는 절대 포함되지 않는다(NFR-S1)', () => {
    const snapshot = buildSnapshot('User', { id: '1', email: 'a@b.com', name: '홍길동', role: 'ADMIN', status: 'ACTIVE', passwordHash: 'secret-hash' });
    expect(snapshot).toEqual({ email: 'a@b.com', name: '홍길동', role: 'ADMIN', status: 'ACTIVE' });
    expect(snapshot).not.toHaveProperty('passwordHash');
  });

  it('entity가 null/undefined면 null을 반환한다', () => {
    expect(buildSnapshot('Chatbot', null)).toBeNull();
    expect(buildSnapshot('Chatbot', undefined)).toBeNull();
  });

  it('Session의 화이트리스트는 비어 있다(인증 이력은 before/after를 쓰지 않는다)', () => {
    expect(buildSnapshot('Session', { id: '1' })).toEqual({});
  });
});

describe('serializeSnapshot — FR-13-11', () => {
  it('null 스냅샷은 json:null을 반환한다', () => {
    expect(serializeSnapshot(null)).toEqual({ json: null, truncated: false });
  });

  it('작은 스냅샷은 절단 없이 그대로 직렬화한다', () => {
    const result = serializeSnapshot({ name: 'foo' });
    expect(result.truncated).toBe(false);
    expect(JSON.parse(result.json as string)).toEqual({ name: 'foo' });
  });

  it('8KB를 초과하면 필드를 잘라내고 truncated:true를 표기한다', () => {
    const huge = 'A'.repeat(9000);
    const result = serializeSnapshot({ a: huge, b: 'small' });
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.json as string, 'utf8')).toBeLessThanOrEqual(8192);
    const parsed = JSON.parse(result.json as string);
    expect(parsed.__truncated).toBe(true);
  });
});
