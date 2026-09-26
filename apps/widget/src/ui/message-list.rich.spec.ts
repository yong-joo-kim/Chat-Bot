// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputView } from '@chat-bot/shared-types/output-view';
import { createMessageList } from './message-list';

afterEach(() => {
  document.body.innerHTML = '';
});

function quickReplyView(...labels: string[]): OutputView {
  return { type: 'BUTTON', payload: { buttons: labels.map((l) => ({ label: l, action: 'MESSAGE' as const, value: l })), display: 'QUICK_REPLY' } };
}

describe('message-list — 바로연결 칩(RM-10, §3.10)', () => {
  it('말풍선 아래·평가 막대 앞에 칩 묶음을 붙인다(같은 삽입 동작, 제약 ⑩)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs(
      [{ type: 'TEXT', payload: { text: '어떤 문의를 도와드릴까요?' } }, quickReplyView('반품 문의', '교환 문의')],
      vi.fn(),
      undefined,
      undefined,
      { messageId: 'm-1', onRate: async () => 'OK', onAnnounce: vi.fn() },
    );
    const msg = list.root.querySelector('.cb-msg-bot')!;
    expect(msg.children).toHaveLength(3);
    expect(msg.children[0].className).toContain('cb-bubble');
    expect(msg.children[1].className).toContain('cb-quick-replies');
    expect(msg.children[2].className).toContain('cb-feedback-bar');
  });

  it('한 턴에 바로연결이 2개면 마지막만 칩이고 앞선 것은 말풍선 안 일반 버튼으로 보인다(EX-RM-11)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs([quickReplyView('첫번째'), quickReplyView('두번째')], vi.fn());
    const msg = list.root.querySelector('.cb-msg-bot')!;
    const chipGroup = msg.querySelector('.cb-quick-replies')!;
    expect(chipGroup.textContent).toBe('두번째');
    const bubble = msg.querySelector('.cb-bubble')!;
    expect(bubble.querySelector('.cb-buttons')?.textContent).toBe('첫번째');
  });

  it('hideQuickReplies는 새 DOM 노드를 만들지 않고 hidden 속성만 바꾼다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs([quickReplyView('반품 문의')], vi.fn());
    const msg = list.root.querySelector('.cb-msg-bot')!;
    const before = msg.children.length;
    const group = msg.querySelector('.cb-quick-replies') as HTMLElement;
    expect(group.hidden).toBe(false);

    const hadFocus = list.hideQuickReplies();
    expect(hadFocus).toBe(false);
    expect(group.hidden).toBe(true);
    expect(msg.children.length).toBe(before);
  });

  it('칩에 포커스가 있었으면 hideQuickReplies가 true를 반환한다(포커스 유실 방지, NFR-RMA4)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs([quickReplyView('반품 문의')], vi.fn());
    const chipBtn = list.root.querySelector<HTMLButtonElement>('.cb-quick-reply')!;
    chipBtn.focus();
    expect(list.hideQuickReplies()).toBe(true);
  });

  it('바로연결이 없는 턴은 hideQuickReplies가 false를 반환하고 아무 것도 바꾸지 않는다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs([{ type: 'TEXT', payload: { text: '안녕' } }], vi.fn());
    expect(list.hideQuickReplies()).toBe(false);
  });
});

describe('message-list — addBotAnswer(보류 RAG 최종 답변)도 addBotOutputs와 같은 규칙을 따른다(코드 리뷰 R1 Medium)', () => {
  it('바로연결 마지막 1개만 칩으로 분리하고, 말풍선 아래·평가 막대 앞에 붙인다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotAnswer(
      'msg-1',
      [{ type: 'TEXT', payload: { text: '답변입니다' } }, quickReplyView('반품 문의', '교환 문의')],
      undefined,
      vi.fn(),
      { messageId: 'msg-1', onRate: async () => 'OK', onAnnounce: vi.fn() },
    );
    const msg = list.root.querySelector('.cb-msg-bot')!;
    expect(msg.children).toHaveLength(3);
    expect(msg.children[0].className).toContain('cb-bubble');
    expect(msg.children[1].className).toContain('cb-quick-replies');
    expect(msg.children[2].className).toContain('cb-feedback-bar');
    expect(msg.querySelector('.cb-quick-replies')?.textContent).toBe('반품 문의교환 문의');
  });

  it('hideQuickReplies가 addBotAnswer로 만든 칩도 숨긴다(공유 상태)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotAnswer('msg-2', [quickReplyView('반품 문의')], undefined, vi.fn());
    const group = list.root.querySelector('.cb-quick-replies') as HTMLElement;
    expect(group.hidden).toBe(false);
    expect(list.hideQuickReplies()).toBe(false);
    expect(group.hidden).toBe(true);
  });

  it('CAROUSEL 아웃풋을 렌더하고, 이전/다음 버튼 클릭 시 onCarouselAnnounce 콜백이 불린다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    const announce = vi.fn();
    const carouselView: OutputView = {
      type: 'CAROUSEL',
      payload: { version: 1, cards: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] },
    };
    await list.addBotAnswer('msg-3', [carouselView], undefined, vi.fn(), undefined, announce);

    expect(list.root.querySelectorAll('.cb-carousel-card')).toHaveLength(3);
    const next = list.root.querySelector('.cb-carousel-nav-btn[aria-label="다음 카드"]') as HTMLButtonElement;
    next.click();
    expect(announce).toHaveBeenCalledWith('3개 중 2번째 카드: B');
  });
});

describe('message-list — 캐러셀(RM-9)', () => {
  it('addBotOutputs가 CAROUSEL 아웃풋을 말풍선 안에 렌더한다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    const carouselView: OutputView = { type: 'CAROUSEL', payload: { version: 1, cards: [{ title: 'A' }, { title: 'B' }] } };
    await list.addBotOutputs([carouselView], vi.fn());
    expect(list.root.querySelector('.cb-carousel')).not.toBeNull();
    expect(list.root.querySelectorAll('.cb-carousel-card')).toHaveLength(2);
  });
});

describe('message-list — 구버전 위젯 강등 입력 호환(P-8, S-6)', () => {
  it('rich-v1 미선언 서버가 캐러셀을 CARD 여러 개로 강등해 보내도(서버 책임) 위젯은 평소처럼 렌더한다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    const degradedViews: OutputView[] = [
      { type: 'CARD', payload: { title: '스타터 요금제' } },
      { type: 'CARD', payload: { title: '스탠다드 요금제' } },
      { type: 'CARD', payload: { title: '프리미엄 요금제' } },
    ];
    await list.addBotOutputs(degradedViews, vi.fn());
    expect(list.root.querySelectorAll('.cb-card')).toHaveLength(3);
    expect(list.root.querySelector('.cb-carousel')).toBeNull();
  });

  it('display 키가 제거된 채 도착한 BUTTON은 평소 버튼 블록으로 렌더된다(칩 묶음 없음)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    const view: OutputView = { type: 'BUTTON', payload: { buttons: [{ label: '반품 문의', action: 'MESSAGE', value: '반품 문의' }] } };
    await list.addBotOutputs([view], vi.fn());
    expect(list.root.querySelector('.cb-quick-replies')).toBeNull();
    expect(list.root.querySelector('.cb-buttons')).not.toBeNull();
  });
});
