import type { DialogOutput } from '@chat-bot/shared-types';
import { outputsToPlainText, toOutputViews } from '@chat-bot/shared-types';

/**
 * [신규 No.46] `outputsToPlainText`(shared-types `output-view.ts`) 캐러셀·바로연결 요약 규칙
 * (`channel-rich-messages-설계.md` §6.2 · FR-RM7-1). `packages/shared-types`에는 jest 러너가 없어
 * 이 apps/api 파일에서 검증한다(CLAUDE.md 규약 — shared-types 빌드 후 소비자 쪽에서 시험).
 */
describe('outputsToPlainText — CAROUSEL·바로연결 요약(FR-RM7-1)', () => {
  it('안내 문구 있는 캐러셀(카드 3장)은 "[캐러셀] 문구 — 제목1 · 제목2 · 제목3"', () => {
    const output: DialogOutput = {
      type: 'CAROUSEL',
      payload: { version: 1, text: '요금제 목록', cards: [{ title: '요금제 A' }, { title: '요금제 B' }, { title: '요금제 C' }] },
    } as unknown as DialogOutput;
    expect(outputsToPlainText([output])).toBe('[캐러셀] 요금제 목록 — 요금제 A · 요금제 B · 요금제 C');
  });

  it('안내 문구 없는 캐러셀은 "[캐러셀] 제목1 · 제목2"', () => {
    const output: DialogOutput = { type: 'CAROUSEL', payload: { version: 1, cards: [{ title: 'A' }, { title: 'B' }] } } as unknown as DialogOutput;
    expect(outputsToPlainText([output])).toBe('[캐러셀] A · B');
  });

  it('카드 6장이면 앞 5장만 나열하고 "외 1장"이 붙는다', () => {
    const cards = Array.from({ length: 6 }, (_, i) => ({ title: `카드${i + 1}` }));
    const output: DialogOutput = { type: 'CAROUSEL', payload: { version: 1, cards } } as unknown as DialogOutput;
    expect(outputsToPlainText([output])).toBe('[캐러셀] 카드1 · 카드2 · 카드3 · 카드4 · 카드5 외 1장');
  });

  it('문구가 있는 바로연결은 "[바로연결] 문구"(기존 [버튼] 대신)', () => {
    const output: DialogOutput = { type: 'BUTTON', payload: { text: '메뉴를 골라 주세요', buttons: [{ label: 'A', action: 'MESSAGE', value: 'A' }], display: 'QUICK_REPLY' } } as unknown as DialogOutput;
    expect(outputsToPlainText([output])).toBe('[바로연결] 메뉴를 골라 주세요');
  });

  it('문구 없는 바로연결은 라벨을 나열한다 "[바로연결] 라벨1 · 라벨2"', () => {
    const output: DialogOutput = {
      type: 'BUTTON',
      payload: { buttons: [{ label: '반품', action: 'MESSAGE', value: '반품' }, { label: '교환', action: 'MESSAGE', value: '교환' }], display: 'QUICK_REPLY' },
    } as unknown as DialogOutput;
    expect(outputsToPlainText([output])).toBe('[바로연결] 반품 · 교환');
  });

  it('display 없는 일반 BUTTON 요약은 불변이다', () => {
    const output: DialogOutput = { type: 'BUTTON', payload: { text: '문구', buttons: [{ label: 'A', action: 'MESSAGE', value: 'A' }] } } as unknown as DialogOutput;
    expect(outputsToPlainText([output])).toBe('[버튼] 문구');
  });

  it('PAUSE·비표시 6종은 생략된다(기존과 동일)', () => {
    const outputs: DialogOutput[] = [
      { type: 'TEXT', payload: { text: '안녕' } },
      { type: 'PAUSE', payload: { durationMs: 300 } },
      { type: 'CONTEXT_FORM', payload: { contextVariableId: '11111111-1111-1111-1111-111111111111' } },
    ];
    expect(outputsToPlainText(outputs)).toBe('안녕');
  });
});

describe('toOutputViews — RENDERABLE_TYPES에 CAROUSEL 포함(FR-RM5-4)', () => {
  it('CAROUSEL이 표시 대상에 포함된다', () => {
    const outputs: DialogOutput[] = [
      { type: 'CAROUSEL', payload: { version: 1, cards: [{ title: 'A' }, { title: 'B' }] } } as unknown as DialogOutput,
      { type: 'CONTEXT_FORM', payload: { contextVariableId: '11111111-1111-1111-1111-111111111111' } },
    ];
    const views = toOutputViews(outputs);
    expect(views).toHaveLength(1);
    expect(views[0].type).toBe('CAROUSEL');
  });
});
