import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { DialogOutput } from '@chat-bot/shared-types';
import { OutputRenderer } from './OutputRenderer';

/**
 * 되묻기 세로 스택 판정(`allowStackedLayout`, `nlu-rag-answering-ui-spec.md` §4.5.2) 회귀 시험 —
 * `apps/widget`의 `renderers/button.spec.ts`와 동일한 휴리스틱을 공유한다(마크업만 앱별,
 * `OutputRenderer.tsx` 주석 참고). code-reviewer 지적(Medium) — 이 로직에 전용 단위시험이 없었다.
 */
function buttonOutput(labels: string[]): DialogOutput {
  return {
    type: 'BUTTON',
    payload: { buttons: labels.map((label) => ({ label, action: 'MESSAGE', value: label })) },
  } as DialogOutput;
}

describe('OutputRenderer — allowStackedLayout(FR-N1-12, ui-spec §4.5.2)', () => {
  it('그룹 내 전원이 MESSAGE 액션이고 라벨 중 하나라도 10자를 초과하면 세로 스택 클래스가 붙는다', () => {
    const { container } = render(
      <OutputRenderer outputs={[buttonOutput(['결제카드 등록해주세요', '포인트카드 조회'])]} onButtonClick={vi.fn()} />,
    );
    expect(container.querySelector('.output-buttons')?.className).toContain('output-buttons--stacked');
  });

  it('라벨이 전부 10자 이하이면 MESSAGE 액션이어도 세로 스택하지 않는다(경계값)', () => {
    const { container } = render(<OutputRenderer outputs={[buttonOutput(['배송 조회', '환불'])]} onButtonClick={vi.fn()} />);
    expect(container.querySelector('.output-buttons')?.className).not.toContain('output-buttons--stacked');
  });

  it('그룹에 NODE/LINK 액션이 하나라도 섞이면 라벨이 길어도 세로 스택하지 않는다(대화노드 퀵메뉴 자연 제외)', () => {
    const output: DialogOutput = {
      type: 'BUTTON',
      payload: {
        buttons: [
          { label: '결제카드 등록해주세요', action: 'NODE', value: 'node-1' },
          { label: '포인트카드 조회', action: 'MESSAGE', value: '포인트카드 조회' },
        ],
      },
    } as DialogOutput;
    const { container } = render(<OutputRenderer outputs={[output]} onButtonClick={vi.fn()} />);
    expect(container.querySelector('.output-buttons')?.className).not.toContain('output-buttons--stacked');
  });

  it('CARD 버튼은 전부 MESSAGE·긴 라벨이어도 항상 가로 배치다(allowStackedLayout=false 구조적 강제)', () => {
    const cardOutput: DialogOutput = {
      type: 'CARD',
      payload: { title: '상품', buttons: [{ label: '결제카드 등록해주세요', action: 'MESSAGE', value: '결제카드 등록해주세요' }] },
    } as DialogOutput;
    const { container } = render(<OutputRenderer outputs={[cardOutput]} onButtonClick={vi.fn()} />);
    const group = container.querySelector('.output-card .output-buttons');
    expect(group).not.toBeNull();
    expect(group?.className).not.toContain('output-buttons--stacked');
  });
});

/**
 * `nlu-rag-answering-ui-spec.md` §10 "알려진 제한사항" 회귀 고정 — 이 오탐은 고쳐야 할 버그가
 * 아니라 문서화된 한계다(백엔드 계약에 "이 BUTTON 출력이 되묻기인지" 구분 필드가 없다). 이
 * 테스트는 "버그가 없다"가 아니라 **문서에 적힌 그대로 동작한다**를 고정해, 향후 누군가
 * 휴리스틱을 조용히 바꿔 이 알려진 동작이 의도와 다르게 변하는 것을 막는다.
 */
describe('알려진 제한사항 회귀 고정 — 전원 MESSAGE 액션인 일반 퀵메뉴도 세로 스택 오탐 가능(ui-spec §10)', () => {
  it('되묻기가 아닌 일반 대화노드 퀵메뉴라도, 관리자가 버튼을 전부 MESSAGE 액션(라벨 10자 초과)으로만 구성했다면 세로 스택으로 렌더된다', () => {
    const { container } = render(
      <OutputRenderer outputs={[buttonOutput(['자주 묻는 질문 보기', '상담사 연결 요청하기'])]} onButtonClick={vi.fn()} />,
    );
    expect(container.querySelector('.output-buttons')?.className).toContain('output-buttons--stacked');
  });
});
