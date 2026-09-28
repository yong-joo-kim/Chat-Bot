import { buildExternalFileName, isValidExternalFileName } from './external-file-name';

describe('buildExternalFileName (KB-20)', () => {
  it('형식이 kb_<8>_<16>.<ext>다', () => {
    const name = buildExternalFileName('11111111-2222-3333-4444-555555555555', 'https://a.example/x', 'docx');
    expect(isValidExternalFileName(name)).toBe(true);
    expect(name).toMatch(/^kb_[0-9a-f]{8}_[0-9a-f]{16}\.(docx|txt|html|pdf|xlsx|pptx)$/);
  });

  it('같은 입력은 항상 같은 이름이다(결정적) — 1,000건', () => {
    for (let i = 0; i < 1000; i += 1) {
      const sourceId = `${i.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`;
      const url = `https://a.example/page-${i}`;
      const a = buildExternalFileName(sourceId, url, 'docx');
      const b = buildExternalFileName(sourceId, url, 'docx');
      expect(a).toBe(b);
      expect(isValidExternalFileName(a)).toBe(true);
    }
  });

  it('다른 소스는 접두 8자가 달라진다', () => {
    const a = buildExternalFileName('aaaaaaaa-0000-0000-0000-000000000000', 'https://a.example/x', 'docx');
    const b = buildExternalFileName('bbbbbbbb-0000-0000-0000-000000000000', 'https://a.example/x', 'docx');
    expect(a.slice(0, 11)).not.toBe(b.slice(0, 11));
  });

  it('같은 소스의 다른 URL은 해시 16자가 달라진다', () => {
    const a = buildExternalFileName('aaaaaaaa-0000-0000-0000-000000000000', 'https://a.example/x', 'docx');
    const b = buildExternalFileName('aaaaaaaa-0000-0000-0000-000000000000', 'https://a.example/y', 'docx');
    expect(a).not.toBe(b);
  });

  it('isValidExternalFileName은 잘못된 형식을 거부한다', () => {
    expect(isValidExternalFileName('kb_short.docx')).toBe(false);
    expect(isValidExternalFileName('../etc/passwd')).toBe(false);
  });
});
