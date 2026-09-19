import { DEFAULT_CHATBOT_SKIN } from '@chat-bot/shared-types';
import { mergeSkin, parseSkin, serializeSkin } from './skin.util';

describe('parseSkin', () => {
  it('parses valid skin JSON as-is', () => {
    const raw = JSON.stringify({ primaryColor: '#123456', headerTitle: '제목', logoUrl: 'https://a.com/l.png' });
    const { skin, fellBackToDefault } = parseSkin(raw);
    expect(fellBackToDefault).toBe(false);
    expect(skin).toEqual({ primaryColor: '#123456', headerTitle: '제목', logoUrl: 'https://a.com/l.png' });
  });

  it('falls back to the default skin on invalid JSON (EX-4-1)', () => {
    const { skin, fellBackToDefault, warning } = parseSkin('{not-json');
    expect(fellBackToDefault).toBe(true);
    expect(skin).toEqual(DEFAULT_CHATBOT_SKIN);
    expect(warning).toBeDefined();
  });

  it('falls back to the default skin when schema validation fails', () => {
    const { skin, fellBackToDefault } = parseSkin(JSON.stringify({ primaryColor: 'not-a-color' }));
    expect(fellBackToDefault).toBe(true);
    expect(skin).toEqual(DEFAULT_CHATBOT_SKIN);
  });
});

describe('serializeSkin', () => {
  it('round-trips through parseSkin', () => {
    const original = { primaryColor: '#0F62FE', headerTitle: 'OO기업 고객센터' };
    const { skin } = parseSkin(serializeSkin(original));
    expect(skin).toEqual(original);
  });
});

describe('mergeSkin', () => {
  const current = { primaryColor: '#4F46E5', headerTitle: '챗봇 상담', logoUrl: 'https://a.com/logo.png' };

  it('keeps fields untouched when the patch omits them (undefined = 유지, D-10)', () => {
    expect(mergeSkin(current, {})).toEqual(current);
  });

  it('overwrites only the provided fields', () => {
    expect(mergeSkin(current, { primaryColor: '#0F62FE' })).toEqual({ ...current, primaryColor: '#0F62FE' });
  });

  it('deletes logoUrl when the patch explicitly sends null (FR-4-7, D-10)', () => {
    const result = mergeSkin(current, { logoUrl: null });
    expect(result.logoUrl).toBeUndefined();
    expect('logoUrl' in result).toBe(false);
  });

  it('resets to default values via an explicit patch (AC-4-6)', () => {
    const result = mergeSkin(current, {
      primaryColor: DEFAULT_CHATBOT_SKIN.primaryColor,
      headerTitle: DEFAULT_CHATBOT_SKIN.headerTitle,
      logoUrl: null,
    });
    expect(result).toEqual(DEFAULT_CHATBOT_SKIN);
  });
});
