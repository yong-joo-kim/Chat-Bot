import type { DialogOutput } from '@chat-bot/shared-types';
import { maskOutputText } from './output-text-fields';

const upper = (s: string): string => s.toUpperCase();

/**
 * [신규 No.46] `maskOutputText` — CAROUSEL 전 필드 마스킹 + 비표시 6종 명시 case(FR-0-198 · C-3).
 * 통합 시험(`integration/channel-rich-messages.integration.spec.ts`)은 실제 금지어 치환을 검증하고,
 * 이 단위 시험은 필드 화이트리스트가 CAROUSEL의 모든 사용자 노출 문자열에 적용됨을 고정한다.
 */
describe('maskOutputText — CAROUSEL', () => {
  it('안내 문구·카드 제목·설명·대체 텍스트·버튼 라벨이 전부 transform을 거친다', () => {
    const output: DialogOutput = {
      type: 'CAROUSEL',
      payload: {
        version: 1,
        text: 'text',
        cards: [
          { title: 'title', description: 'description', imageUrl: 'https://img.example.com/a.png', altText: 'alt', buttons: [{ label: 'label', action: 'MESSAGE', value: 'value' }] },
          { title: 'title2' },
        ],
      },
    } as unknown as DialogOutput;

    const result = maskOutputText(output, upper) as Extract<DialogOutput, { type: 'CAROUSEL' }>;

    expect(result.payload.text).toBe('TEXT');
    expect(result.payload.cards[0].title).toBe('TITLE');
    expect(result.payload.cards[0].description).toBe('DESCRIPTION');
    expect(result.payload.cards[0].altText).toBe('ALT');
    expect(result.payload.cards[0].buttons?.[0].label).toBe('LABEL');
    // 버튼 value(MESSAGE 문구)·이미지 주소는 마스킹 대상이 아니다(기존 CARD·BUTTON 규약과 동일).
    expect(result.payload.cards[0].buttons?.[0].value).toBe('value');
    expect(result.payload.cards[0].imageUrl).toBe('https://img.example.com/a.png');
    expect(result.payload.cards[1].title).toBe('TITLE2');
  });

  it('안내 문구·설명·대체 텍스트·버튼이 없는 최소 카드는 오류 없이 통과한다', () => {
    const output: DialogOutput = { type: 'CAROUSEL', payload: { version: 1, cards: [{ title: 'a' }, { title: 'b' }] } } as unknown as DialogOutput;
    const result = maskOutputText(output, upper) as Extract<DialogOutput, { type: 'CAROUSEL' }>;
    expect(result.payload.cards[0].title).toBe('A');
    expect(result.payload.cards[0].description).toBeUndefined();
  });
});

describe('maskOutputText — 바로연결 BUTTON(display 유지 확인)', () => {
  it('display 유무와 무관하게 기존 BUTTON 규약대로 라벨·문구를 마스킹하고 display를 보존한다', () => {
    const output: DialogOutput = { type: 'BUTTON', payload: { text: 'text', buttons: [{ label: 'label', action: 'MESSAGE', value: 'value' }], display: 'QUICK_REPLY' } } as unknown as DialogOutput;
    const result = maskOutputText(output, upper) as Extract<DialogOutput, { type: 'BUTTON' }>;
    expect(result.payload.text).toBe('TEXT');
    expect(result.payload.buttons[0].label).toBe('LABEL');
    expect(result.payload.display).toBe('QUICK_REPLY');
  });
});

describe('maskOutputText — 비표시 6종은 명시 case로 원본을 그대로 반환한다(RM-3)', () => {
  const nonDisplayable: DialogOutput[] = [
    { type: 'CONTEXT_FORM', payload: { contextVariableId: '11111111-1111-1111-1111-111111111111' } },
    { type: 'DIALOG_MOVE', payload: { targetNodeId: '11111111-1111-1111-1111-111111111111' } },
    { type: 'SCENARIO', payload: { scenarioKey: 'k' } },
    { type: 'SURVEY', payload: { surveyId: 'legacy' } },
    {
      type: 'API_CONDITION',
      payload: { method: 'GET', url: 'https://a.example.com', conditions: [{ path: 'x', operator: 'EXISTS', nextNodeId: '11111111-1111-1111-1111-111111111111' }] },
    },
    { type: 'WORKFLOW', payload: { version: 1, targetId: '11111111-1111-1111-1111-111111111111', actionKey: 'a.b', fields: [] } },
    { type: 'PAUSE', payload: { durationMs: 500 } },
  ];

  it.each(nonDisplayable.map((o) => [o.type, o] as const))('%s는 transform이 호출되지 않고 원본과 동일하다', (_type, output) => {
    const transform = jest.fn((s: string) => s);
    const result = maskOutputText(output, transform);
    expect(result).toEqual(output);
    expect(transform).not.toHaveBeenCalled();
  });
});
