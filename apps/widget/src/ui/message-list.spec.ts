// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OutputView } from '@chat-bot/shared-types/output-view';
import { createMessageList } from './message-list';

/**
 * No.44 위젯 변경의 핵심 불변식 — `#cb-messages`(role="log")에 **새 노드를 추가하지 않는다**는
 * 규칙(`feedback-loop-ui-spec.md` §3.2.1, `UIUX_준수기준.md` §8 신규 항목)을 DOM 레벨로 검증한다.
 */

const TEXT_VIEWS: OutputView[] = [{ type: 'TEXT', payload: { text: '안녕하세요' } }];

afterEach(() => {
  document.body.innerHTML = '';
});

describe('message-list — feedback 바인딩이 있을 때만 평가 막대를 붙인다(FR-FB9-3)', () => {
  it('feedback 인자가 없으면 addBotOutputs는 평가 막대를 붙이지 않는다', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs(TEXT_VIEWS, vi.fn());
    expect(list.root.querySelector('.cb-feedback-bar')).toBeNull();
  });

  it('feedback 인자가 있으면 .cb-msg 안, .cb-bubble 바로 다음 형제로 평가 막대를 붙인다(말풍선 밖)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotOutputs(TEXT_VIEWS, vi.fn(), undefined, undefined, {
      messageId: 'msg-1',
      onRate: async () => 'OK',
      onAnnounce: vi.fn(),
    });
    const msg = list.root.querySelector('.cb-msg-bot')!;
    expect(msg.children).toHaveLength(2);
    expect(msg.children[0].className).toContain('cb-bubble');
    expect(msg.children[1].className).toContain('cb-feedback-bar');
  });

  it('addBotAnswer도 같은 규칙을 따른다(보류 RAG 최종 답변)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    await list.addBotAnswer('msg-2', TEXT_VIEWS, undefined, vi.fn(), {
      messageId: 'msg-2',
      onRate: async () => 'OK',
      onAnnounce: vi.fn(),
    });
    const msg = list.root.querySelector('.cb-msg-bot')!;
    expect(msg.querySelector('.cb-feedback-bar')).not.toBeNull();
  });

  it('상담원 말풍선(addAgentText)에는 평가 막대가 없다(No.24 핸드오프와의 공존)', () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    list.addAgentText('안녕하세요, 상담원입니다.');
    const agentMsg = list.root.querySelector('.cb-msg-agent')!;
    expect(agentMsg.querySelector('.cb-feedback-bar')).toBeNull();
  });
});

describe('message-list — #cb-messages(role=log) 노드 수 불변(UIUX_준수기준.md §8)', () => {
  it('평가 막대가 있는 말풍선 추가는 #cb-messages에 자식 노드를 1개만 늘린다(막대는 그 안의 형제일 뿐)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    const before = list.root.children.length;
    await list.addBotOutputs(TEXT_VIEWS, vi.fn(), undefined, undefined, {
      messageId: 'msg-3',
      onRate: async () => 'OK',
      onAnnounce: vi.fn(),
    });
    expect(list.root.children.length).toBe(before + 1);
  });

  it('평가 버튼 클릭에 따른 상태 변화는 #cb-messages의 자식 노드 수를 바꾸지 않는다(속성만 변경)', async () => {
    const list = createMessageList();
    document.body.appendChild(list.root);
    let resolveRate!: (v: 'OK') => void;
    await list.addBotOutputs(TEXT_VIEWS, vi.fn(), undefined, undefined, {
      messageId: 'msg-4',
      onRate: () => new Promise((resolve) => { resolveRate = resolve; }),
      onAnnounce: vi.fn(),
    });
    const countAfterAdd = list.root.children.length;
    const upBtn = list.root.querySelector<HTMLButtonElement>('.cb-feedback-up')!;
    upBtn.click();
    expect(list.root.children.length).toBe(countAfterAdd);
    resolveRate('OK');
    await vi.waitFor(() => expect(upBtn.disabled).toBe(false));
    expect(list.root.children.length).toBe(countAfterAdd);
  });
});
