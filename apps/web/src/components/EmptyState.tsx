import type { ReactNode } from 'react';

/** 데이터 없음(오류 아님). 중립 색상만 사용하고 빨강은 금지한다(FR-2-10, AC-2-6). */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <div className="empty-state">
      <p className="empty-state-title">
        <span aria-hidden="true">ⓘ</span> {title}
      </p>
      {description && <p className="empty-state-desc">{description}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
