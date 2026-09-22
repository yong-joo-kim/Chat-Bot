import type { ReactNode } from 'react';

export interface ProposalContainerProps {
  /** 컨테이너 헤더에 항상 병기하는 텍스트 라벨(색상 단독 금지, UIUX §1). 예: "제안(승인 전)". */
  title: string;
  /** "승인 전까지 대화에 영향을 주지 않습니다" 류의 상시 안내(컨테이너 최상단 고정, sticky 아님). */
  safetyNotice: string;
  children: ReactNode;
}

/**
 * "제안-자산 분리" 레이아웃 패턴의 제안 컨테이너 셸(learning-augmentation-ui-spec.md §2/§3, P-1~P-3).
 * 옅은 주의색 배경 + 점선 테두리로 자산(확정) 컨테이너와 물리적으로 분리해 렌더한다.
 * 자산으로의 승격은 이 컨테이너 안의 단일 진입점 버튼을 통해서만 이뤄져야 한다(P-4, 이 컴포넌트는
 * 셸만 제공하고 승격 버튼은 `children`으로 넘어온다 — 자산 쪽에 대응 버튼을 두지 않는 것은 호출부 책임).
 */
export function ProposalContainer({ title, safetyNotice, children }: ProposalContainerProps): JSX.Element {
  return (
    <div className="proposal-container">
      <div className="proposal-container-header">
        <span className="proposal-container-label">{title}</span>
        <p className="proposal-container-notice" role="status">
          <span aria-hidden="true">ℹ</span> {safetyNotice}
        </p>
      </div>
      <div className="proposal-container-body">{children}</div>
    </div>
  );
}
