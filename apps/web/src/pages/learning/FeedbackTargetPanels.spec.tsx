import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { FeedbackTargetRef } from '@chat-bot/shared-types';
import { FeedbackTargetEditLink, feedbackTargetLabel, type FeedbackTargetRefWithDraftInfo } from './FeedbackTargetPanels';

function target(overrides: Partial<FeedbackTargetRefWithDraftInfo> = {}): FeedbackTargetRefWithDraftInfo {
  return { kind: 'FAQ', id: 'faq-1', name: '환불 안내', deleted: false, ...overrides } as FeedbackTargetRefWithDraftInfo;
}

/** [신규 No.40] 평가 상세 "초안에 없음"(`environment-separation-ui-spec.md` §4.16). */
describe('feedbackTargetLabel — 초안에 없음(No.40)', () => {
  it('deletedInDraft + nameFromVersion이 있으면 "초안에 없음(운영 버전에는 …)" 문구를 쓴다', () => {
    const t = target({ deleted: true, name: undefined, deletedInDraft: true, nameFromVersion: '환불 안내' });
    expect(feedbackTargetLabel(t)).toBe("FAQ · 초안에 없음(운영 버전에는 '환불 안내'으로 있음)");
  });

  it('deletedInDraft가 없으면(모드 꺼짐 또는 진짜 삭제) 기존 "삭제됨" 문구를 그대로 쓴다', () => {
    const t = target({ deleted: true, name: undefined });
    expect(feedbackTargetLabel(t)).toBe('FAQ · 삭제됨');
  });

  it('정상 대상이면 기존 문구 그대로다', () => {
    const t = target();
    expect(feedbackTargetLabel(t)).toBe("FAQ '환불 안내'");
  });
});

describe('FeedbackTargetEditLink — 초안에 없음일 때 링크 없음(No.40)', () => {
  it('deletedInDraft이면 편집 링크를 렌더하지 않는다', () => {
    const t = target({ deletedInDraft: true, nameFromVersion: '환불 안내' });
    const { container } = render(
      <MemoryRouter>
        <FeedbackTargetEditLink chatbotId="bot-1" target={t} />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('정상 FAQ 대상이면 편집 링크를 렌더한다', () => {
    const t = target();
    render(
      <MemoryRouter>
        <FeedbackTargetEditLink chatbotId="bot-1" target={t} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'FAQ 편집' })).toHaveAttribute('href', '/chatbots/bot-1/dialogue/faqs?edit=faq-1');
  });
});

// 하위 호환: 일반 FeedbackTargetRef(확장 필드 없음)도 그대로 전달할 수 있어야 한다(값이 있을 때만 키).
describe('하위 호환 — 확장 필드 없는 FeedbackTargetRef', () => {
  it('일반 FeedbackTargetRef를 넘겨도 타입/동작 문제가 없다', () => {
    const plain: FeedbackTargetRef = { kind: 'NODE', id: 'node-1', name: '시작 노드', deleted: false };
    expect(feedbackTargetLabel(plain)).toBe("노드 '시작 노드'");
  });
});
