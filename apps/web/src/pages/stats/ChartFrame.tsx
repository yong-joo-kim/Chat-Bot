import { useId, useState, type ReactNode } from 'react';
import { MESSAGES } from '../../constants/messages';

export interface ChartFrameProps {
  title: string;
  /** 대체 텍스트로 쓰이는 한 줄 요약 문장(NFR-A2). 항상 시각적으로도 노출된다(§2.5). */
  summary: string;
  chart: ReactNode;
  table: ReactNode;
  /** 모바일(<640px)처럼 기본값을 표로 시작하고 싶을 때(§10 반응형 원칙). */
  defaultView?: 'chart' | 'table';
}

/**
 * 차트 접근성 공용 셸(FR-C-3/4, NFR-A1/A2, stats-learning-ui-spec.md §2.5).
 * 표 보기 토글은 `chart`/`table`을 조건부 렌더링한다(둘 다 마운트 후 `hidden`으로 숨기지 않는다 —
 * 스크린리더가 숨겨진 콘텐츠까지 읽을 위험을 피하기 위함).
 */
export function ChartFrame({ title, summary, chart, table, defaultView = 'chart' }: ChartFrameProps): JSX.Element {
  const [view, setView] = useState<'chart' | 'table'>(defaultView);
  const headingId = useId();

  return (
    <section className="chart-frame" aria-labelledby={headingId}>
      <div className="chart-frame-header">
        <h3 id={headingId}>{title}</h3>
        <button
          type="button"
          className="btn btn-secondary chart-frame-toggle"
          aria-pressed={view === 'table'}
          onClick={() => setView((v) => (v === 'chart' ? 'table' : 'chart'))}
        >
          {view === 'chart' ? MESSAGES.stats.viewTable : MESSAGES.stats.viewChart}
        </button>
      </div>
      <p className="chart-frame-summary">
        <span aria-hidden="true">ⓘ</span> {summary}
      </p>
      {view === 'chart' ? (
        <div className="chart-frame-chart" role="img" aria-label={summary}>
          {chart}
        </div>
      ) : (
        <div className="chart-frame-table">{table}</div>
      )}
    </section>
  );
}
