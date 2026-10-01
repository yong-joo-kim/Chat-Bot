import { PassThrough, Readable } from 'node:stream';
import { readBoundedBody } from './read-bounded-body';

describe('readBoundedBody(§5.3 8단계)', () => {
  it('상한 이내면 메모리로 모아 반환한다', async () => {
    const stream = Readable.from([Buffer.from('abc'), Buffer.from('def')]);
    const result = await readBoundedBody(stream, 100, 1000);
    expect(result.kind).toBe('OK');
    if (result.kind === 'OK') expect(result.body.toString()).toBe('abcdef');
  });

  it('0바이트 본문은 EMPTY', async () => {
    expect((await readBoundedBody(Readable.from([]), 100, 1000)).kind).toBe('EMPTY');
  });

  it('상한을 넘으면 즉시 TOO_LARGE로 읽기를 멈춘다(이후 청크는 버려진다)', async () => {
    const stream = new PassThrough();
    const pending = readBoundedBody(stream, 10, 1000);
    stream.write(Buffer.alloc(6));
    stream.write(Buffer.alloc(6));
    const result = await pending;
    expect(result.kind).toBe('TOO_LARGE');
    expect(stream.isPaused()).toBe(true);
    stream.destroy();
  });

  it('정확히 상한 바이트는 허용한다(경계)', async () => {
    expect((await readBoundedBody(Readable.from([Buffer.alloc(10)]), 10, 1000)).kind).toBe('OK');
    expect((await readBoundedBody(Readable.from([Buffer.alloc(11)]), 10, 1000)).kind).toBe('TOO_LARGE');
  });

  it('수신 시간 상한을 넘으면 TIMEOUT(느린 업로드 — 슬로로리스 방어)', async () => {
    const stream = new PassThrough();
    const result = await readBoundedBody(stream, 100, 30);
    expect(result.kind).toBe('TIMEOUT');
    stream.destroy();
  });

  it('end 없이 연결이 닫히면 ABORTED', async () => {
    const stream = new PassThrough();
    const pending = readBoundedBody(stream, 100, 1000);
    stream.write(Buffer.from('half'));
    stream.destroy();
    expect((await pending).kind).toBe('ABORTED');
  });

  it('오류 이벤트는 ABORTED이며 이후 오류가 처리되지 않은 예외가 되지 않는다', async () => {
    const stream = new PassThrough();
    const pending = readBoundedBody(stream, 100, 1000);
    stream.emit('error', new Error('boom'));
    expect((await pending).kind).toBe('ABORTED');
    expect(() => stream.emit('error', new Error('again'))).not.toThrow();
  });
});
