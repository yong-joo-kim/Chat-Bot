import { WorkerEntryMissingError } from '../extract/kb-extractor.port';
import type { KbExtractResult, KbExtractorPort } from '../extract/kb-extractor.port';
import { inspectRawFile } from './inspect-raw-file';

const base: KbExtractResult = { ok: true, normalizedText: 'x', text: 'x', piiMaskedCount: 0, flags: [] };
const extractorOf = (r: KbExtractResult | Error): KbExtractorPort & { extract: jest.Mock } => ({
  extract: jest.fn(async () => {
    if (r instanceof Error) throw r;
    return r;
  }),
});

describe('inspectRawFile (RG-8)', () => {
  it('PDF는 PDF 요청으로, OOXML 3종은 형식과 함께 OOXML 요청으로 넘긴다(바이트는 복사본)', async () => {
    const ex = extractorOf({ ...base, piiMaskedCount: 2 });
    const bytes = Buffer.from('abc');
    expect(await inspectRawFile(ex, 'PDF', bytes)).toEqual({ ok: true, piiMaskedCount: 2, truncated: false });
    expect(await inspectRawFile(ex, 'XLSX', bytes)).toEqual({ ok: true, piiMaskedCount: 2, truncated: false });
    expect(ex.extract.mock.calls[0][0]).toMatchObject({ kind: 'PDF' });
    expect(ex.extract.mock.calls[1][0]).toMatchObject({ kind: 'OOXML', format: 'XLSX' });
    expect(ex.extract.mock.calls[0][0].bytes.buffer).not.toBe(bytes.buffer);
  });
  it('암호화 표시는 FILE_ENCRYPTED, ok=false는 FILE_UNSAFE', async () => {
    expect(await inspectRawFile(extractorOf({ ...base, encrypted: true, flags: ['FILE_ENCRYPTED'] }), 'PDF', Buffer.from('x'))).toEqual({ ok: false, reason: 'FILE_ENCRYPTED' });
    expect(await inspectRawFile(extractorOf({ ...base, ok: false, flags: ['FILE_ENCRYPTED'] }), 'DOCX', Buffer.from('x'))).toEqual({ ok: false, reason: 'FILE_ENCRYPTED' });
    expect(await inspectRawFile(extractorOf({ ...base, ok: false, flags: ['FILE_UNSAFE'] }), 'DOCX', Buffer.from('x'))).toEqual({ ok: false, reason: 'FILE_UNSAFE' });
  });
  it('알 수 없는 종류는 검사할 수 없으므로 FILE_UNSAFE', async () => {
    expect(await inspectRawFile(extractorOf(base), 'HWP', Buffer.from('x'))).toEqual({ ok: false, reason: 'FILE_UNSAFE' });
  });
  it('추출 예외는 그 파일만 FILE_UNSAFE — 워커 진입점 부재(전역 설정 오류)는 올린다', async () => {
    expect(await inspectRawFile(extractorOf(new Error('FILE_UNSAFE_TIMEOUT')), 'PDF', Buffer.from('x'))).toEqual({ ok: false, reason: 'FILE_UNSAFE' });
    await expect(inspectRawFile(extractorOf(new WorkerEntryMissingError('없음')), 'PDF', Buffer.from('x'))).rejects.toBeInstanceOf(WorkerEntryMissingError);
  });
});

describe('inspectRawFile — N-9 truncated(300쪽·텍스트 2MB 초과로 일부만 검사)', () => {
  it('★ 거버넌스 ON + truncated → FILE_UNSAFE(검사하지 못한 구간의 개인정보가 나갈 수 있다)', async () => {
    const ex = extractorOf({ ...base, truncated: true });
    expect(await inspectRawFile(ex, 'PDF', Buffer.from('x'), { governanceOn: true })).toEqual({ ok: false, reason: 'FILE_UNSAFE' });
  });
  it('거버넌스 OFF + truncated는 통과하고 잘림 여부를 알려 준다', async () => {
    const ex = extractorOf({ ...base, truncated: true, piiMaskedCount: 1 });
    expect(await inspectRawFile(ex, 'PDF', Buffer.from('x'), { governanceOn: false })).toEqual({ ok: true, piiMaskedCount: 1, truncated: true });
    expect(await inspectRawFile(ex, 'PDF', Buffer.from('x'))).toEqual({ ok: true, piiMaskedCount: 1, truncated: true }); // 옵션 생략 = OFF
  });
  it('거버넌스 ON이라도 전체를 검사했으면(truncated 아님) 통과한다', async () => {
    expect(await inspectRawFile(extractorOf(base), 'PDF', Buffer.from('x'), { governanceOn: true })).toEqual({ ok: true, piiMaskedCount: 0, truncated: false });
  });
  it('암호화·안전하지 않음 판정이 truncated보다 먼저다', async () => {
    const enc = extractorOf({ ...base, encrypted: true, truncated: true, flags: ['FILE_ENCRYPTED'] });
    expect(await inspectRawFile(enc, 'PDF', Buffer.from('x'), { governanceOn: true })).toEqual({ ok: false, reason: 'FILE_ENCRYPTED' });
  });
});
