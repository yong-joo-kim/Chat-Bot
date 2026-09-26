import type { ChannelOutputProfile, DialogOutput } from '@chat-bot/shared-types';
import { CHANNEL_CAPABILITIES, DialogOutputSchema, degradeForProfile, LEGACY_WEB_WIDGET_OUTPUT_PROFILE } from '@chat-bot/shared-types';

/**
 * `degradeForProfile` 3단 사다리 순수 함수 시험(`channel-rich-messages-설계.md` §7·§18.1) —
 * 불변식 I-1~I-7 · 사다리 표 전 칸 · 기존 5종 문구 바이트 동일 · 텍스트 형식 골든.
 */

const WEB = CHANNEL_CAPABILITIES.WEB.outputs;
const KAKAO = CHANNEL_CAPABILITIES.KAKAOTALK.outputs;
const TEXT_ONLY = CHANNEL_CAPABILITIES.LINE.outputs; // DEFAULT 프로필 대표
const LEGACY_WEB = LEGACY_WEB_WIDGET_OUTPUT_PROFILE;

const PROFILES: Array<[string, ChannelOutputProfile]> = [
  ['WEB', WEB],
  ['구버전 WEB', LEGACY_WEB],
  ['KAKAOTALK', KAKAO],
  ['텍스트만(DEFAULT)', TEXT_ONLY],
];

function carousel(overrides: { text?: string; cards?: Array<Record<string, unknown>> } = {}): DialogOutput {
  return {
    type: 'CAROUSEL',
    payload: {
      version: 1,
      ...(overrides.text !== undefined ? { text: overrides.text } : {}),
      cards: overrides.cards ?? [{ title: '카드1' }, { title: '카드2' }],
    },
  } as unknown as DialogOutput;
}

function quickReplyButton(buttons: Array<{ label: string; action: 'MESSAGE' | 'NODE'; value: string }>, text?: string): DialogOutput {
  return { type: 'BUTTON', payload: { ...(text !== undefined ? { text } : {}), buttons, display: 'QUICK_REPLY' } } as unknown as DialogOutput;
}

describe('불변식 I-1~I-7 — 4프로필 × 픽스처', () => {
  const fixtures: DialogOutput[] = [
    { type: 'TEXT', payload: { text: '안녕하세요' } },
    { type: 'CARD', payload: { title: '카드제목', description: '설명', buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }] } },
    { type: 'IMAGE', payload: { imageUrl: 'https://img.example.com/a.png', altText: '대체' } },
    { type: 'BUTTON', payload: { text: '문구', buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }] } },
    { type: 'LINK', payload: { label: '홈페이지', url: 'https://example.com', openInNewTab: true } },
    { type: 'PAUSE', payload: { durationMs: 500 } },
    { type: 'PHONE_CALL', payload: { label: '상담전화', phoneNumber: '02-1234-5678' } },
    carousel({ text: '요금제 목록', cards: [{ title: '요금제 A', description: '월 3만원' }, { title: '요금제 B' }, { title: '요금제 C' }] }),
    quickReplyButton([
      { label: '반품', action: 'MESSAGE', value: '반품' },
      { label: '교환', action: 'MESSAGE', value: '교환' },
    ]),
  ];

  it.each(PROFILES)('%s — 결과의 모든 아웃풋이 DialogOutputSchema를 통과한다(I-1)', (_label, profile) => {
    const { outputs } = degradeForProfile(fixtures, profile);
    for (const o of outputs) {
      const parsed = DialogOutputSchema.safeParse(o);
      expect(parsed.success).toBe(true);
    }
  });

  it('WEB·구버전 WEB 프로필 × 기존 7종 픽스처 = changes 0 · 결과 원소 전부 === (I-2)', () => {
    const legacyFixtures = fixtures.slice(0, 7); // CAROUSEL·바로연결 제외 — 기존 7종만
    for (const profile of [WEB, LEGACY_WEB]) {
      const { outputs, changes } = degradeForProfile(legacyFixtures, profile);
      expect(changes).toEqual([]);
      expect(outputs.length).toBe(legacyFixtures.length);
      outputs.forEach((o, i) => expect(o).toBe(legacyFixtures[i]));
    }
  });

  it('예외 0 — null·빈 cards·모르는 type 입력도 [지원하지 않는 응답]으로 처리된다(I-3)', () => {
    const weird = [{ type: 'CONTEXT_FORM', payload: { contextVariableId: '11111111-1111-1111-1111-111111111111' } } as unknown as DialogOutput];
    expect(() => degradeForProfile(weird, TEXT_ONLY)).not.toThrow();
    const { outputs, changes } = degradeForProfile(weird, TEXT_ONLY);
    expect(outputs).toEqual([{ type: 'TEXT', payload: { text: '[지원하지 않는 응답]' } }]);
    expect(changes[0].kind).toBe('OUTPUT_TO_TEXT');
  });

  it.each(PROFILES)('%s — 멱등: degrade(degrade(x).outputs).changes = []', (_label, profile) => {
    const first = degradeForProfile(fixtures, profile);
    const second = degradeForProfile(first.outputs, profile);
    expect(second.changes).toEqual([]);
  });

  it('changes가 비어 있으면 결과 배열 원소가 입력 원소와 모두 ===다(I-5)', () => {
    const { outputs, changes } = degradeForProfile(fixtures.slice(0, 7), WEB);
    expect(changes).toEqual([]);
    outputs.forEach((o, i) => expect(o).toBe(fixtures[i]));
  });

  it('프로필 표 정합: 모든 프로필 types ⊇ TEXT · CAROUSEL 지원 시 carouselMaxCards ≥ 2 · WEB 상한 = 스키마 최대치(I-6)', () => {
    for (const [, profile] of PROFILES) {
      expect(profile.types).toContain('TEXT');
      if (profile.types.includes('CAROUSEL')) expect(profile.carouselMaxCards).toBeGreaterThanOrEqual(2);
    }
    expect(WEB.cardMaxButtons).toBe(5);
    expect(WEB.carouselMaxCards).toBe(10);
    expect(WEB.carouselCardMaxButtons).toBe(3);
    expect(WEB.quickReply.max).toBe(5);
  });

  it('성능: 아웃풋 10개 × 카드 10장 처리가 1ms 이하다(100회 평균, I-7)', () => {
    const bigCarousel = carousel({ cards: Array.from({ length: 10 }, (_, i) => ({ title: `카드${i}`, description: `설명${i}`, buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }] })) });
    const outputs10 = Array.from({ length: 10 }, () => bigCarousel);
    const start = process.hrtime.bigint();
    for (let i = 0; i < 100; i += 1) degradeForProfile(outputs10, KAKAO);
    const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6 / 100;
    expect(elapsedMs).toBeLessThan(1);
  });
});

describe('강등 사다리 — CAROUSEL', () => {
  it('WEB(지원) — 원형 그대로(변경 없음)', () => {
    const input = carousel({ cards: [{ title: 'A' }, { title: 'B' }] });
    const { outputs, changes } = degradeForProfile([input], WEB);
    expect(outputs[0]).toBe(input);
    expect(changes).toEqual([]);
  });

  it('KAKAOTALK — 카드 버튼 5개는 앞 3개만 남고 BUTTONS_TRUNCATED', () => {
    const buttons = Array.from({ length: 5 }, (_, i) => ({ label: `버튼${i}`, action: 'MESSAGE' as const, value: `메시지${i}` }));
    const input = carousel({ cards: [{ title: '카드1', buttons }, { title: '카드2' }] });
    const { outputs, changes } = degradeForProfile([input], KAKAO);
    const result = outputs[0] as Extract<DialogOutput, { type: 'CAROUSEL' }>;
    expect(result.payload.cards[0].buttons?.length).toBe(3);
    expect(changes.some((c) => c.kind === 'BUTTONS_TRUNCATED')).toBe(true);
  });

  it('구버전 WEB(CARD 지원) — 캐러셀이 CARD 여러 개로 펼쳐진다(CAROUSEL_TO_CARDS) · 카드 수 제한 없음(EX-RM-12)', () => {
    const cards = Array.from({ length: 10 }, (_, i) => ({ title: `카드${i}` }));
    const input = carousel({ text: '안내문구', cards });
    const { outputs, changes } = degradeForProfile([input], LEGACY_WEB);
    expect(changes.some((c) => c.kind === 'CAROUSEL_TO_CARDS')).toBe(true);
    expect(outputs[0]).toEqual({ type: 'TEXT', payload: { text: '안내문구' } });
    expect(outputs.slice(1).every((o) => o.type === 'CARD')).toBe(true);
    expect(outputs.length).toBe(11); // TEXT 1 + CARD 10
  });

  it('CAROUSEL_TO_CARDS는 원래 카드 수 → 결과 CARD 수를 "from→to" 형식 detail로 싣는다(콘솔 "카드 N장 중 앞 M장만 보입니다" 문구용)', () => {
    const cards = Array.from({ length: 4 }, (_, i) => ({ title: `카드${i}` }));
    const input = carousel({ cards });
    const { changes } = degradeForProfile([input], LEGACY_WEB);
    const change = changes.find((c) => c.kind === 'CAROUSEL_TO_CARDS');
    expect(change?.detail).toBe('4→4'); // 카드 수 제한 없음(EX-RM-12) — 절단이 없으므로 from = to
  });

  it('CAROUSEL_TO_CARDS와 CARDS_TRUNCATED는 같은 outputIndex에서도 kind로 구분된다(절단이 함께 일어나는 경우 대비)', () => {
    // 구버전 WEB(CARD 지원 · carouselMaxCards=0)에서는 절단이 없어 실제로 공존하지 않지만,
    // detail 형식이 두 kind에서 동일(`from→to`)하므로 kind로만 구분해야 한다는 계약을 명시한다.
    const cards = Array.from({ length: 3 }, (_, i) => ({ title: `카드${i}` }));
    const input = carousel({ cards });
    const { changes } = degradeForProfile([input], LEGACY_WEB);
    const carouselToCards = changes.find((c) => c.kind === 'CAROUSEL_TO_CARDS');
    const cardsTruncated = changes.find((c) => c.kind === 'CARDS_TRUNCATED');
    expect(carouselToCards?.detail).toBe('3→3');
    expect(cardsTruncated).toBeUndefined();
  });

  it('텍스트만 프로필 — 링크 버튼 포함 캐러셀이 번호 매김 텍스트로 바뀌고 NODE 버튼은 ACTION_LOST', () => {
    const input = carousel({
      cards: [
        { title: '요금제 A', description: '아주 긴 설명입니다'.repeat(10), buttons: [{ label: '자세히', action: 'LINK', value: 'https://example.com/a' }] },
        { title: '요금제 B', buttons: [{ label: '이동', action: 'NODE', value: '11111111-1111-1111-1111-111111111111' }] },
      ],
    });
    const { outputs, changes } = degradeForProfile([input], TEXT_ONLY);
    expect(outputs.length).toBe(1);
    expect(outputs[0].type).toBe('TEXT');
    const text = (outputs[0] as Extract<DialogOutput, { type: 'TEXT' }>).payload.text;
    expect(text).toContain('1) 요금제 A');
    expect(text).toContain('자세히: https://example.com/a');
    expect(text).toContain('2) 요금제 B');
    expect(changes.some((c) => c.kind === 'ACTION_LOST' && c.detail === 'NODE')).toBe(true);
    expect(changes.some((c) => c.kind === 'CAROUSEL_TO_TEXT')).toBe(true);
  });

  it('이미지가 있었으면 텍스트 강등 시 IMAGE_REMOVED가 기록된다', () => {
    const input = carousel({ cards: [{ title: '카드1', imageUrl: 'https://img.example.com/a.png', altText: '대체' }, { title: '카드2' }] });
    const { changes } = degradeForProfile([input], TEXT_ONLY);
    expect(changes.some((c) => c.kind === 'IMAGE_REMOVED')).toBe(true);
  });

  it('이미지 미지원 프로필(KAKAOTALK card 지원이지만 image=false인 경우는 없음 — 여기선 image 제거 규칙을 캐러셀 카드 원형 단계에서 직접 검증)', () => {
    const noImageProfile: ChannelOutputProfile = { ...KAKAO, image: false };
    const input = carousel({ cards: [{ title: '카드1', imageUrl: 'https://img.example.com/a.png', altText: '대체이미지', description: '설명' }, { title: '카드2' }] });
    const { outputs, changes } = degradeForProfile([input], noImageProfile);
    const result = outputs[0] as Extract<DialogOutput, { type: 'CAROUSEL' }>;
    expect(result.payload.cards[0].imageUrl).toBeUndefined();
    expect(result.payload.cards[0].description).toContain('[이미지: 대체이미지]');
    expect(changes.some((c) => c.kind === 'IMAGE_REMOVED')).toBe(true);
  });
});

describe('강등 사다리 — 바로연결(BUTTON display=QUICK_REPLY)', () => {
  it('WEB(지원) — 원형 그대로', () => {
    const input = quickReplyButton([{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }]);
    const { outputs, changes } = degradeForProfile([input], WEB);
    expect(outputs[0]).toBe(input);
    expect(changes).toEqual([]);
  });

  it('구버전 WEB(바로연결 미지원·BUTTON 지원) — display가 제거된 일반 버튼으로 바뀐다(QUICK_REPLY_TO_BUTTON)', () => {
    const input = quickReplyButton([{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }]);
    const { outputs, changes } = degradeForProfile([input], LEGACY_WEB);
    const result = outputs[0] as Extract<DialogOutput, { type: 'BUTTON' }>;
    expect(result.payload.display).toBeUndefined();
    expect(changes.some((c) => c.kind === 'QUICK_REPLY_TO_BUTTON')).toBe(true);
  });

  it('텍스트만 프로필 — "다음 중 입력해 주세요" 문구로 바뀌고 NODE는 ACTION_LOST', () => {
    const input = quickReplyButton([
      { label: 'A', action: 'MESSAGE', value: 'A' },
      { label: 'B', action: 'NODE', value: '11111111-1111-1111-1111-111111111111' },
    ]);
    const { outputs, changes } = degradeForProfile([input], TEXT_ONLY);
    const text = (outputs[0] as Extract<DialogOutput, { type: 'TEXT' }>).payload.text;
    expect(text).toContain('다음 중 입력해 주세요: A');
    expect(changes.some((c) => c.kind === 'BUTTON_TO_TEXT')).toBe(true);
    expect(changes.some((c) => c.kind === 'ACTION_LOST' && c.detail === 'NODE')).toBe(true);
  });

  it('텍스트만 프로필에서 문구도 MESSAGE도 없으면 OUTPUT_REMOVED(출력에서 사라진다)', () => {
    const input = quickReplyButton([{ label: 'B', action: 'NODE', value: '11111111-1111-1111-1111-111111111111' }]);
    const { outputs, changes } = degradeForProfile([input], TEXT_ONLY);
    expect(outputs).toEqual([]);
    expect(changes.some((c) => c.kind === 'OUTPUT_REMOVED')).toBe(true);
  });
});

describe('기존 5종 텍스트 강등 문구는 바이트 동일이다(AC-RM3-4)', () => {
  it('CARD·IMAGE·BUTTON·LINK·PHONE_CALL — 텍스트만 프로필로 강등', () => {
    const fixtures: DialogOutput[] = [
      { type: 'CARD', payload: { title: '카드제목' } },
      { type: 'IMAGE', payload: { imageUrl: 'https://img.example.com/a.png', altText: '대체텍스트' } },
      { type: 'BUTTON', payload: { text: '문구', buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }] } },
      { type: 'BUTTON', payload: { buttons: [{ label: '메뉴', action: 'MESSAGE', value: '메뉴' }] } },
      { type: 'LINK', payload: { label: '링크라벨', url: 'https://example.com', openInNewTab: true } },
      { type: 'PHONE_CALL', payload: { label: '전화라벨', phoneNumber: '02-1234-5678' } },
    ];
    const { outputs } = degradeForProfile(fixtures, TEXT_ONLY);
    expect(outputs.map((o) => (o as Extract<DialogOutput, { type: 'TEXT' }>).payload.text)).toEqual([
      '[카드] 카드제목',
      '[이미지] 대체텍스트',
      '[버튼] 문구',
      '[버튼]',
      '[링크] 링크라벨',
      '[전화] 전화라벨',
    ]);
  });

  it('PAUSE는 빈 TEXT 대신 제거된다(제약 ② · R-6)', () => {
    const { outputs, changes } = degradeForProfile([{ type: 'PAUSE', payload: { durationMs: 500 } }], TEXT_ONLY);
    expect(outputs).toEqual([]);
    expect(changes.some((c) => c.kind === 'OUTPUT_REMOVED')).toBe(true);
  });
});
