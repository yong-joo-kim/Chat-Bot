import { describe, expect, it } from 'vitest';
import { resolveButtonAction, shouldSendToServer } from './button-action';

describe('widget core/button-action — 공유 판정 로직 위임(FR-W-6, DD-24)', () => {
  it('MESSAGE 액션은 서버로 전송해야 한다', () => {
    const action = resolveButtonAction({ label: '선박', action: 'MESSAGE', value: '선박' });
    expect(action).toEqual({ kind: 'MESSAGE', label: '선박', text: '선박' });
    expect(shouldSendToServer(action)).toBe(true);
  });

  it('NODE 액션은 서버로 전송해야 한다', () => {
    const nodeId = '11111111-1111-1111-1111-111111111111';
    const action = resolveButtonAction({ label: '주문 조회', action: 'NODE', value: nodeId });
    expect(action).toEqual({ kind: 'NODE', label: '주문 조회', nodeId });
    expect(shouldSendToServer(action)).toBe(true);
  });

  it('LINK 액션은 서버로 전송하지 않는다(AC-W-10)', () => {
    const action = resolveButtonAction({ label: '자세히 보기', action: 'LINK', value: 'https://example.com' });
    expect(action.kind).toBe('LINK');
    expect(action.href).toBe('https://example.com');
    expect(shouldSendToServer(action)).toBe(false);
  });

  it('LINK 값이 http(s)가 아니면 href가 비어 렌더가 생략된다', () => {
    const action = resolveButtonAction({ label: '위험', action: 'LINK', value: 'javascript:alert(1)' });
    expect(action.href).toBeUndefined();
  });
});
