import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ApiConnectionListItem, ApiErrorDetail } from '@chat-bot/shared-types';
import { DeleteApiConnectionConfirmDialog } from './DeleteApiConnectionConfirmDialog';

function makeConnection(): ApiConnectionListItem {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'ERP 주문',
    description: null,
    baseUrl: 'https://erp.corp.local/api',
    baseUrlHost: 'erp.corp.local',
    allowedMethods: ['GET'],
    authType: 'NONE',
    authHeaderName: null,
    secretRef: null,
    timeoutMs: 3000,
    rateLimitPerMin: 120,
    allowRawPersonalData: false,
    personalDataLookup: false,
    sampleCount: 0,
    enabled: true,
    secretStatus: 'NOT_REQUIRED',
    insecureHttp: false,
    circuitOpen: false,
    referencingNodeCount: 1,
    stats24h: { calls: 0, failures: 0 },
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    updatedAt: new Date('2026-09-01T00:00:00.000Z'),
  };
}

/** [No.26 1차 코드리뷰 반영] `details[].chatbotId`(계약 확장)로 노드 편집 딥링크를 만든다. */
describe('DeleteApiConnectionConfirmDialog — 참조 노드 딥링크', () => {
  it('chatbotId가 있으면 "챗봇명 › 노드명" 텍스트가 노드 편집 링크가 된다', () => {
    const details: ApiErrorDetail[] = [{ field: 'node-9', message: '주문 상담봇 › 주문조회_실행', chatbotId: 'bot-9' }];

    render(
      <MemoryRouter>
        <DeleteApiConnectionConfirmDialog
          connection={makeConnection()}
          inUseDetails={details}
          submitting={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: '주문 상담봇 › 주문조회_실행' });
    expect(link).toHaveAttribute('href', '/chatbots/bot-9/dialogue/nodes/node-9');
  });

  it('chatbotId가 없으면 링크 없이 텍스트만 표시한다(계약 미확장 시 회귀 방지)', () => {
    const details: ApiErrorDetail[] = [{ field: 'node-9', message: '주문 상담봇 › 주문조회_실행' }];

    render(
      <MemoryRouter>
        <DeleteApiConnectionConfirmDialog
          connection={makeConnection()}
          inUseDetails={details}
          submitting={false}
          onConfirm={vi.fn()}
          onCancel={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText('주문 상담봇 › 주문조회_실행')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /주문 상담봇/ })).not.toBeInTheDocument();
  });
});
