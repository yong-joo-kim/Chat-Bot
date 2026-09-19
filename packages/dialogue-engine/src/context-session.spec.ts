import { advanceContextSession, startContextSession } from './context-session';
import { makeContext } from './test-fixtures';
import type { ContextSessionState } from '@chat-bot/shared-types';

const NOW = new Date('2026-01-01T12:00:00Z');

function coffeeContext() {
  return makeContext({
    name: '커피주문',
    slots: [
      { name: '메뉴', label: '메뉴', prompt: '메뉴를 선택해 주세요.', type: 'CHOICE', required: true, choices: ['아메리카노', '라떼'], maxRetry: 2 },
      { name: '사이즈', label: '사이즈', prompt: '사이즈를 선택해 주세요.', type: 'CHOICE', required: true, choices: ['톨', '그란데'], maxRetry: 2 },
      { name: '수량', label: '수량', prompt: '수량을 입력해 주세요.', type: 'NUMBER', required: true, validation: { min: 1, max: 10 }, maxRetry: 2 },
    ],
    completionMessage: '{메뉴} {사이즈} {수량}잔 주문 확인했습니다.',
    cancelKeywords: ['취소', '그만', '처음으로'],
    sessionTimeoutMinutes: 30,
  });
}

describe('advanceContextSession — FR-8-8~16', () => {
  it('AC-8-1: 세션을 시작하면 첫 슬롯 인덱스가 0이고 IN_PROGRESS다', () => {
    const def = coffeeContext();
    const session = startContextSession(def, NOW);
    expect(session.currentSlotIndex).toBe(0);
    expect(session.status).toBe('IN_PROGRESS');
  });

  it('AC-8-2: 선택형 슬롯에 값을 입력하면 다음 슬롯으로 진행한다', () => {
    const def = coffeeContext();
    const session = startContextSession(def, NOW);
    const { state, outputs } = advanceContextSession(session, { raw: '아메리카노', norm: '아메리카노' }, def, NOW, []);

    expect(state.filledValues['메뉴']).toBe('아메리카노');
    expect(state.currentSlotIndex).toBe(1);
    expect(outputs[0]).toEqual({ type: 'TEXT', payload: { text: '사이즈를 선택해 주세요.' } });
  });

  it('AC-8-3: 숫자 슬롯에 잘못된 값을 넣으면 retryCount가 증가하고 슬롯이 진행되지 않는다', () => {
    const def = coffeeContext();
    let session: ContextSessionState = { ...startContextSession(def, NOW), currentSlotIndex: 2 };
    const { state } = advanceContextSession(session, { raw: '백만', norm: '백만' }, def, NOW, []);

    expect(state.retryCount).toBe(1);
    expect(state.currentSlotIndex).toBe(2);
    expect(state.status).toBe('IN_PROGRESS');
  });

  it('AC-8-4: maxRetry 초과 시 세션이 CANCELLED로 종료된다', () => {
    const def = coffeeContext();
    let session: ContextSessionState = { ...startContextSession(def, NOW), currentSlotIndex: 2 };
    for (let i = 0; i < 2; i += 1) {
      session = advanceContextSession(session, { raw: '백만', norm: '백만' }, def, NOW, []).state;
    }
    const result = advanceContextSession(session, { raw: '백만', norm: '백만' }, def, NOW, []);
    expect(result.state.status).toBe('CANCELLED');
  });

  it('AC-8-5: 취소어는 슬롯 검증보다 우선해 즉시 CANCELLED로 종료한다', () => {
    const def = coffeeContext();
    const session = startContextSession(def, NOW);
    const result = advanceContextSession(session, { raw: '취소', norm: '취소' }, def, NOW, []);
    expect(result.state.status).toBe('CANCELLED');
  });

  it('AC-8-6: 타임아웃 경과 후 입력이 오면 EXPIRED로 처리하고 선택 버튼을 출력한다', () => {
    const def = coffeeContext();
    const past = new Date(NOW.getTime() - 31 * 60_000);
    const session: ContextSessionState = { ...startContextSession(def, past), lastInteractedAt: past };
    const result = advanceContextSession(session, { raw: '아메리카노', norm: '아메리카노' }, def, NOW, []);

    expect(result.state.status).toBe('EXPIRED');
    expect(result.outputs[0].type).toBe('BUTTON');
  });

  it('AC-8-7: 모든 필수 슬롯이 채워지면 COMPLETED되고 치환자가 실제 값으로 바뀐다', () => {
    const def = coffeeContext();
    let session = startContextSession(def, NOW);
    session = advanceContextSession(session, { raw: '아메리카노', norm: '아메리카노' }, def, NOW, []).state;
    session = advanceContextSession(session, { raw: '톨', norm: '톨' }, def, NOW, []).state;
    const result = advanceContextSession(session, { raw: '2', norm: '2' }, def, NOW, []);

    expect(result.state.status).toBe('COMPLETED');
    expect(result.outputs[0]).toEqual({
      type: 'TEXT',
      payload: { text: '아메리카노 톨 2잔 주문 확인했습니다.' },
    });
  });

  it('AC-8-8: 선택 슬롯은 건너뛰기 입력으로 값 없이 통과한다', () => {
    const def = makeContext({
      slots: [
        { name: 'required1', label: '필수1', prompt: '필수값?', type: 'TEXT', required: true, maxRetry: 2 },
        { name: 'optional1', label: '선택1', prompt: '선택값?', type: 'TEXT', required: false, maxRetry: 2 },
      ],
    });
    let session = startContextSession(def, NOW);
    session = advanceContextSession(session, { raw: '값1', norm: '값1' }, def, NOW, []).state;
    const result = advanceContextSession(session, { raw: '건너뛰기', norm: '건너뛰기' }, def, NOW, []);

    expect(result.state.filledValues['optional1']).toBeUndefined();
    expect(result.state.status).toBe('COMPLETED');
  });
});
