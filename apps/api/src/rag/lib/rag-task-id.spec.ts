import { toRagTaskId } from './rag-task-id';

describe('toRagTaskId', () => {
  it('UUID 형식이면 브랜드 값을 반환한다', () => {
    expect(toRagTaskId('3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70')).toBe('3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70');
  });
  it('대문자 혼합도 소문자화해 통과한다', () => {
    expect(toRagTaskId('3F2A1B8C-5D6E-4F70-8A91-2B3C4D5E6F70')).toBe('3f2a1b8c-5d6e-4f70-8a91-2b3c4d5e6f70');
  });
  it('비UUID는 null', () => {
    expect(toRagTaskId('not-a-uuid')).toBeNull();
  });
  it('경로 문자(../)가 섞이면 null', () => {
    expect(toRagTaskId('../../etc/passwd')).toBeNull();
  });
  it('빈 문자열은 null', () => {
    expect(toRagTaskId('')).toBeNull();
  });
});
