import { computeContentHash } from './snapshot-canonical';
import type { SnapshotEnvelope } from './snapshot-envelope';

/**
 * [신규 No.46] 골든 해시(AC-RM1-2 · RM-16) — 채널별 리치 메시지 도입 **전**(커밋 `9113b1d`) 코드로
 * 계산한 `contentHash`를 리터럴로 고정한다. `CarouselOutputPayloadV1Schema`·`ButtonOutputPayloadSchema`
 * 어디에도 `.default()`가 없어(RM-10) 이 픽스처(새 컴포넌트를 쓰지 않는 노드)의 해시는 도입 후에도
 * 바이트 단위로 같다 — `snapshot-canonical.ts`·`snapshot-envelope.ts`는 이 그룹에서 변경 0이다.
 */
const GOLDEN_HASH_NO_RICH_COMPONENTS = '8879137a9641523f7557ed693e4b9ce0f81347152c1176ccb53527639b9c5f99';

function buildFixtureEnvelope(): SnapshotEnvelope {
  return {
    schemaVersion: 1,
    capturedAt: '2026-01-01T00:00:00.000Z',
    chatbotId: 'chatbot-fixture',
    assets: {
      intents: [],
      keywords: [],
      homonyms: [],
      dialogNodes: [
        {
          id: 'node-1',
          name: '골든노드',
          nodeType: 'NORMAL',
          matchMode: 'ANY',
          enabled: true,
          priority: 100,
          intentIds: [],
          keywordIds: [],
          outputs: [
            { type: 'TEXT', payload: { text: '안녕하세요' } },
            {
              type: 'CARD',
              payload: {
                title: '요금제 A',
                description: '월 3만원',
                imageUrl: 'https://img.example.com/a.png',
                altText: '요금제 A 이미지',
                buttons: [
                  { label: '자세히', action: 'LINK', value: 'https://example.com/a' },
                  { label: '상담', action: 'NODE', value: '11111111-1111-1111-1111-111111111111' },
                  { label: '문의', action: 'MESSAGE', value: '문의합니다' },
                  { label: '취소', action: 'MESSAGE', value: '취소합니다' },
                  { label: '처음으로', action: 'NODE', value: '22222222-2222-2222-2222-222222222222' },
                ],
              },
            },
            { type: 'BUTTON', payload: { text: '메뉴를 골라 주세요', buttons: [{ label: '요금제', action: 'MESSAGE', value: '요금제' }] } },
            { type: 'BUTTON', payload: { buttons: [{ label: '처음으로', action: 'NODE', value: '33333333-3333-3333-3333-333333333333' }] } },
            { type: 'LINK', payload: { label: '공식 홈페이지', url: 'https://example.com', openInNewTab: true } },
            { type: 'IMAGE', payload: { imageUrl: 'https://img.example.com/b.png', altText: '안내 이미지' } },
          ],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
      contexts: [],
      faqs: [],
    },
    answerSetting: null,
    profile: { name: '골든챗봇', avatarUrl: null, description: null, skin: { primaryColor: '#4F46E5', headerTitle: '챗봇 상담' } },
  } as unknown as SnapshotEnvelope;
}

describe('AC-RM1-2 — 골든 해시: 새 컴포넌트를 쓰지 않는 노드의 contentHash는 도입 전과 바이트 동일', () => {
  it('TEXT·CARD(버튼 5)·BUTTON(문구 유/무)·LINK·IMAGE 픽스처의 해시가 고정값과 같다', () => {
    expect(computeContentHash(buildFixtureEnvelope())).toBe(GOLDEN_HASH_NO_RICH_COMPONENTS);
  });

  it('BUTTON 페이로드를 다시 파싱해도(zod) display 키가 생기지 않는다(RM-10 런타임 검증)', async () => {
    const { DialogOutputSchema } = await import('@chat-bot/shared-types');
    const parsed = DialogOutputSchema.parse({ type: 'BUTTON', payload: { buttons: [{ label: '처음으로', action: 'NODE', value: '33333333-3333-3333-3333-333333333333' }] } });
    expect(parsed.type).toBe('BUTTON');
    expect('display' in (parsed as { payload: object }).payload).toBe(false);
  });
});
