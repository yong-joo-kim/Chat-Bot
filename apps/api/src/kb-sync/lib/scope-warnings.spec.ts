import { computeScopeWarnings } from './scope-warnings';

describe('computeScopeWarnings — 3차 보완 설계서 :1078', () => {
  it('둘 다 정상이면 경고가 없다', () => {
    expect(computeScopeWarnings({ sharedByOtherSource: false, readByAnyChatbot: true })).toEqual([]);
  });

  it('다른 소스가 같은 3단 스코프를 쓰면 SCOPE_SHARED_WITH_OTHER_SOURCE', () => {
    expect(computeScopeWarnings({ sharedByOtherSource: true, readByAnyChatbot: true })).toEqual([{ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' }]);
  });

  it('이 스코프를 읽는 챗봇이 없으면 SCOPE_NOT_READ_BY_ANY_CHATBOT', () => {
    expect(computeScopeWarnings({ sharedByOtherSource: false, readByAnyChatbot: false })).toEqual([{ code: 'SCOPE_NOT_READ_BY_ANY_CHATBOT' }]);
  });

  it('★ 둘 다 해당하면 두 경고를 모두 낸다(순서: 공유 → 미독)', () => {
    expect(computeScopeWarnings({ sharedByOtherSource: true, readByAnyChatbot: false })).toEqual([{ code: 'SCOPE_SHARED_WITH_OTHER_SOURCE' }, { code: 'SCOPE_NOT_READ_BY_ANY_CHATBOT' }]);
  });
});
