import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DegradeChange } from '@chat-bot/shared-types';
import { DegradeChangesNotice } from './DegradeChangesNotice';

describe('DegradeChangesNotice — CAROUSEL_TO_CARDS(코드 리뷰 R1 Medium, EX-RM-12 무손실)', () => {
  it('detail "N→N"에서 N을 읽어 "캐러셀이 카드 N장으로 나뉘어 보입니다."를 보여준다', () => {
    const changes: DegradeChange[] = [{ outputIndex: 0, kind: 'CAROUSEL_TO_CARDS', detail: '3→3' }];
    render(<DegradeChangesNotice changes={changes} />);
    expect(screen.getByText('캐러셀이 카드 3장으로 나뉘어 보입니다.')).toBeInTheDocument();
  });

  it('detail이 없으면 고정 폴백 문구를 보여준다', () => {
    const changes: DegradeChange[] = [{ outputIndex: 0, kind: 'CAROUSEL_TO_CARDS' }];
    render(<DegradeChangesNotice changes={changes} />);
    expect(screen.getByText('카드 여러 장으로 나뉘어 보입니다.')).toBeInTheDocument();
  });

  it('0건이면 렌더하지 않는다', () => {
    const { container } = render(<DegradeChangesNotice changes={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
