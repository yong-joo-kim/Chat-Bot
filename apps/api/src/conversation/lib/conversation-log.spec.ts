import type { TraceStep } from '@chat-bot/shared-types';
import { buildBotResponseText, judgeAnswered } from './conversation-log';

describe('judgeAnswered — DD-31', () => {
  it('폴백 코드가 없으면 true(응답됨)다', () => {
    const trace: TraceStep[] = [{ stage: 'NODE', code: 'NODE_MATCHED', targetId: 'n1' }];
    expect(judgeAnswered(trace)).toBe(true);
  });

  it('FALLBACK_NODE가 있으면 false다(폴백 노드에 다른 코드가 뒤에 붙어도)', () => {
    const trace: TraceStep[] = [
      { stage: 'FALLBACK', code: 'FALLBACK_NODE', targetId: 'n1' },
      { stage: 'OUTPUT', code: 'BROKEN_REFERENCE', targetId: 'x' },
    ];
    expect(judgeAnswered(trace)).toBe(false);
  });

  it('EMPTY_INPUT은 미응답으로 판정된다', () => {
    const trace: TraceStep[] = [{ stage: 'PREPROCESS', code: 'EMPTY_INPUT' }];
    expect(judgeAnswered(trace)).toBe(false);
  });

  it('HOP_LIMIT_EXCEEDED만 있으면 true다(폴백 코드가 아니므로 — 응답은 나갔다)', () => {
    const trace: TraceStep[] = [{ stage: 'OUTPUT', code: 'HOP_LIMIT_EXCEEDED' }];
    expect(judgeAnswered(trace)).toBe(true);
  });
});

describe('buildBotResponseText — FR-11-22', () => {
  it('TEXT 아웃풋은 본문 그대로 저장한다', () => {
    const text = buildBotResponseText([{ type: 'TEXT', payload: { text: '안녕하세요' } }]);
    expect(text).toBe('안녕하세요');
  });

  it('CARD는 [카드] 제목 형태로 요약한다', () => {
    const text = buildBotResponseText([{ type: 'CARD', payload: { title: '상품 안내' } }]);
    expect(text).toBe('[카드] 상품 안내');
  });

  it('2000자를 초과하면 절단된다', () => {
    const longText = 'A'.repeat(2100);
    const text = buildBotResponseText([{ type: 'TEXT', payload: { text: longText } }]);
    expect(text.length).toBe(2001);
    expect(text.endsWith('…')).toBe(true);
  });
});
