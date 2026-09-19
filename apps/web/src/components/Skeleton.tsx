import type { ReactNode } from 'react';

/** 로딩 중 표시(UIUX §8). 최소 200ms 이상 유지해 깜빡임을 방지한다(실제 지속시간은 호출부 로딩 상태에 달려 있음). */
export function SkeletonRow(): JSX.Element {
  return <div className="skeleton skeleton-row" />;
}

export function SkeletonCard(): JSX.Element {
  return <div className="skeleton skeleton-card" />;
}

export function SkeletonBlock({ height = 20 }: { height?: number }): JSX.Element {
  return <div className="skeleton" style={{ height, borderRadius: 6 }} />;
}

/** 스크린리더에 "조회 중" 상태를 알리는 래퍼(UIUX §8). */
export function LoadingRegion({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}
