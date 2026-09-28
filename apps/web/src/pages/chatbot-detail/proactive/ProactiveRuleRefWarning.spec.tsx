import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ProactiveRuleRefWarning } from './ProactiveRuleRefWarning';

let mockCanRead = true;
vi.mock('../../../context/AuthContext', () => ({
  useAuth: () => ({ can: (p: string) => (p === 'channel:read' ? mockCanRead : true) }),
}));

const mockGetOverview = vi.fn();
vi.mock('../../../api/proactive', () => ({
  proactiveApi: { getOverview: (...args: unknown[]) => mockGetOverview(...args) },
}));

const NODE_ID = '11111111-1111-4111-8111-111111111111';

function makeOverview(rules: { id: string; name: string; buttons: { action: string; value: string }[] }[]) {
  return {
    settings: { enabled: true, maxPerSession: 1, minIntervalSec: 60, quietAfterUserMessageSec: 300, updatedAt: null },
    serverEnabled: true,
    context: { chatbotStatus: 'ACTIVE', webChannelEnabled: true, launcherHidden: false, environmentMode: false },
    limits: { rulesMax: 20, enabledRulesMax: 10 },
    rules,
  };
}

beforeEach(() => {
  mockCanRead = true;
  mockGetOverview.mockReset();
});

describe('ProactiveRuleRefWarning — PA-C8(노드 삭제 확인 창 비차단 경고)', () => {
  it('이 노드를 참조하는 규칙이 있으면 경고를 렌더한다(개수·이름 포함)', async () => {
    mockGetOverview.mockResolvedValue(
      makeOverview([{ id: 'rule-1', name: '배송조회 도움', buttons: [{ action: 'NODE', value: NODE_ID }] }]),
    );
    render(<ProactiveRuleRefWarning chatbotId="bot-1" nodeId={NODE_ID} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('이 노드를 가리키는 선제 안내 1개(배송조회 도움)가 더 이상 표시되지 않습니다.');
  });

  it('참조하는 규칙이 없으면 아무것도 렌더하지 않는다', async () => {
    mockGetOverview.mockResolvedValue(makeOverview([{ id: 'rule-1', name: '무관 규칙', buttons: [{ action: 'MESSAGE', value: '문구' }] }]));
    const { container } = render(<ProactiveRuleRefWarning chatbotId="bot-1" nodeId={NODE_ID} />);

    await waitFor(() => expect(mockGetOverview).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('channel:read 권한이 없으면 조회 자체를 하지 않고 아무것도 렌더하지 않는다', () => {
    mockCanRead = false;
    const { container } = render(<ProactiveRuleRefWarning chatbotId="bot-1" nodeId={NODE_ID} />);
    expect(mockGetOverview).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('조회가 실패해도 조용히 무시한다(비차단 — 오류를 사용자에게 보이지 않음, R-9)', async () => {
    mockGetOverview.mockRejectedValue(new Error('network'));
    const { container } = render(<ProactiveRuleRefWarning chatbotId="bot-1" nodeId={NODE_ID} />);
    await waitFor(() => expect(mockGetOverview).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});
