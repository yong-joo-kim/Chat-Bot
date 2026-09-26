import type { DialogOutput } from '@chat-bot/shared-types';
import { collectRichUrls } from './collect-rich-urls';

describe('collectRichUrls — 새 컴포넌트 URL만 수집한다(기존 CARD·IMAGE·LINK·BUTTON은 대상 밖)', () => {
  it('캐러셀 카드 imageUrl·LINK 버튼 값을 zod 경로와 함께 수집한다', () => {
    const outputs: DialogOutput[] = [
      { type: 'TEXT', payload: { text: '안녕' } },
      {
        type: 'CAROUSEL',
        payload: {
          version: 1,
          cards: [
            { title: '카드1', imageUrl: 'https://img.example.com/a.png', altText: '대체', buttons: [{ label: '이동', action: 'LINK', value: 'https://a.example.com' }, { label: '메시지', action: 'MESSAGE', value: 'x' }] },
            { title: '카드2' },
          ],
        },
      } as unknown as DialogOutput,
    ];

    const result = collectRichUrls(outputs);

    expect(result).toEqual([
      { url: 'https://img.example.com/a.png', field: 'outputs.1.payload.cards.0.imageUrl' },
      { url: 'https://a.example.com', field: 'outputs.1.payload.cards.0.buttons.0.value' },
    ]);
  });

  it('기존 CARD·IMAGE·LINK·BUTTON은 수집하지 않는다(하위 호환 — 허용 목록 밖)', () => {
    const outputs: DialogOutput[] = [
      { type: 'CARD', payload: { title: '카드', imageUrl: 'https://img.example.com/legacy.png', altText: '대체' } },
      { type: 'IMAGE', payload: { imageUrl: 'https://img.example.com/b.png', altText: '대체2' } },
      { type: 'LINK', payload: { label: '링크', url: 'https://example.com', openInNewTab: true } },
      { type: 'BUTTON', payload: { buttons: [{ label: '이동', action: 'LINK', value: 'https://c.example.com' }] } },
    ];
    expect(collectRichUrls(outputs)).toEqual([]);
  });

  it('빈 출력·캐러셀 없음은 빈 배열', () => {
    expect(collectRichUrls([])).toEqual([]);
  });
});
