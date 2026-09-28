import { kbErrorCode, kbLogLine } from './kb-log-line';

describe('kbLogLine · kbErrorCode — 로그 누설 금지(pass 4 위반 7 · KB-15)', () => {
  it('kbLogLine은 호스트(소문자)·경로(120자 절단)·코드만 담는다', () => {
    expect(kbLogLine({ host: 'Intra.Example', path: '/a', code: 'X' })).toBe('kb-sync host=intra.example path=/a code=X');
    expect(kbLogLine({ host: 'h', path: 'p'.repeat(300), code: 'X' })).toBe(`kb-sync host=h path=${'p'.repeat(120)} code=X`);
  });

  it('★ kbErrorCode는 오류 원문(message)을 절대 내지 않고 클래스명만 낸다', () => {
    const secret = new Error('GET https://intra.example/private?token=SECRET123 실패 — 응답: 본문 조각');
    const code = kbErrorCode(secret);
    expect(code).toBe('Error');
    expect(code).not.toContain('SECRET123');
    expect(code).not.toContain('intra.example');
  });

  it('사용자 정의 오류 클래스는 그 이름을 낸다', () => {
    class WorkerEntryMissingError extends Error {}
    expect(kbErrorCode(new WorkerEntryMissingError('경로 D:\\secret\\extract.worker.js 없음'))).toBe('WorkerEntryMissingError');
    expect(kbErrorCode(new TypeError('x'))).toBe('TypeError');
  });

  it('Node·라이브러리 오류 코드(대문자 식별자)가 있으면 그것을 낸다 — 클래스명보다 정보가 많다', () => {
    expect(kbErrorCode(Object.assign(new Error('connect ECONNRESET 10.0.0.5:443'), { code: 'ECONNRESET' }))).toBe('ECONNRESET');
    expect(kbErrorCode(Object.assign(new Error('worker oom'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }))).toBe('ERR_WORKER_OUT_OF_MEMORY');
    expect(kbErrorCode(Object.assign(new Error('unique'), { code: 'P2002' }))).toBe('P2002');
  });

  it('식별자 형식이 아닌 code(사용자 문자열이 실릴 수 있다)는 무시하고 클래스명을 낸다', () => {
    expect(kbErrorCode(Object.assign(new Error('x'), { code: 'token=SECRET 값' }))).toBe('Error');
    expect(kbErrorCode(Object.assign(new TypeError('x'), { code: 42 }))).toBe('TypeError');
    expect(kbErrorCode(Object.assign(new Error('x'), { code: 'lowercase' }))).toBe('Error');
  });

  it('오류가 아닌 값(문자열·null·객체)이나 식별자 형식이 아닌 이름은 UnknownError로 대체한다', () => {
    expect(kbErrorCode('token=SECRET')).toBe('UnknownError');
    expect(kbErrorCode(null)).toBe('UnknownError');
    expect(kbErrorCode({ message: 'SECRET' })).toBe('UnknownError');
    const weird = new Error('m');
    Object.defineProperty(weird, 'constructor', { value: { name: 'bad name; token=SECRET' } });
    expect(kbErrorCode(weird)).toBe('UnknownError');
  });
});
