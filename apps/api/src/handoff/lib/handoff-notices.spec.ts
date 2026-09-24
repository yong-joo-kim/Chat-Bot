import { resolveEndSystemMessage } from './handoff-notices';

const SETTINGS = { endNotice: '상담이 종료되었어요.', failNotice: '연결이 어려워요.' };

describe('resolveEndSystemMessage', () => {
  it('NOT_DELIVERED는 FAILED + failNotice다', () => {
    expect(resolveEndSystemMessage('NOT_DELIVERED', SETTINGS)).toEqual({ systemKind: 'FAILED', text: SETTINGS.failNotice });
  });

  it('AGENT_NO_REPLY는 FAILED + failNotice다', () => {
    expect(resolveEndSystemMessage('AGENT_NO_REPLY', SETTINGS)).toEqual({ systemKind: 'FAILED', text: SETTINGS.failNotice });
  });

  it('AGENT_ENDED는 ENDED + endNotice다', () => {
    expect(resolveEndSystemMessage('AGENT_ENDED', SETTINGS)).toEqual({ systemKind: 'ENDED', text: SETTINGS.endNotice });
  });

  it('USER_IDLE·CHANNEL_CLOSED도 ENDED + endNotice다', () => {
    expect(resolveEndSystemMessage('USER_IDLE', SETTINGS).systemKind).toBe('ENDED');
    expect(resolveEndSystemMessage('CHANNEL_CLOSED', SETTINGS).systemKind).toBe('ENDED');
  });
});
