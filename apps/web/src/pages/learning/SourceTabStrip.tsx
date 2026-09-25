import { MESSAGES } from '../../constants/messages';

export type SourceTabValue = 'ALL' | 'UNANSWERED' | 'NEGATIVE_FEEDBACK';

export interface SourceTabStripProps {
  counts: { all: number; unanswered: number; negativeFeedback: number };
  value: SourceTabValue;
  onChange: (value: SourceTabValue) => void;
}

/**
 * [신규 No.44] L1 상단 소스 탭(feedback-loop-ui-spec.md §2.2/§3.3) — 세그먼트형 3탭. 3개뿐이라
 * 표준 Tab 순서로 각 탭에 순차 도달 가능하므로 로빙 탭은 도입하지 않는다(§6.2). 값 변경은
 * "필터 재조회"이므로 UIUX §6(값 변경 자동 제출 금지)의 예외 해석을 따른다(`GranularityPeriodControl` 선례).
 */
export function SourceTabStrip({ counts, value, onChange }: SourceTabStripProps): JSX.Element {
  const options: { key: SourceTabValue; label: string }[] = [
    { key: 'ALL', label: MESSAGES.learning.sourceTabAll },
    { key: 'UNANSWERED', label: MESSAGES.learning.sourceTabUnanswered(counts.unanswered) },
    { key: 'NEGATIVE_FEEDBACK', label: MESSAGES.learning.sourceTabNegativeFeedback(counts.negativeFeedback) },
  ];

  return (
    <div className="source-tab-strip" role="group" aria-label={MESSAGES.learning.columnSource}>
      {options.map((opt) => (
        <button
          key={opt.key}
          type="button"
          className={`btn btn-secondary source-tab-strip-item${value === opt.key ? ' source-tab-strip-item--active' : ''}`}
          aria-pressed={value === opt.key}
          onClick={() => onChange(opt.key)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
