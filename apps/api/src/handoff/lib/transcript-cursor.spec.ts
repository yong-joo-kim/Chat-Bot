import { encodeTranscriptCursor, decodeTranscriptCursor } from './transcript-cursor';

describe('transcript-cursor — §11', () => {
  it('인코딩 후 디코딩하면 원래 값과 같다', () => {
    const cursor = { l: ['2026-01-01T00:00:00.000Z', 'log-1'] as [string, string], m: ['2026-01-01T00:00:01.000Z', 'msg-1'] as [string, string] };
    const encoded = encodeTranscriptCursor(cursor);
    expect(decodeTranscriptCursor(encoded)).toEqual(cursor);
  });

  it('undefined는 null이다(처음부터 조회)', () => {
    expect(decodeTranscriptCursor(undefined)).toBeNull();
  });

  it('손상된 커서는 400이 아니라 null이다(관대한 입력)', () => {
    expect(decodeTranscriptCursor('not-valid-base64url-json!!')).toBeNull();
  });
});
