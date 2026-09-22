export interface BarSegmentDatum {
  value: number;
  /** 범례/색상 구분용 CSS 클래스(`.bar-segment--answered` 등). 색상은 항상 패턴과 함께 쓴다(UIUX §1). */
  className: string;
  pattern?: 'solid' | 'hatch';
}

export interface BarDatum {
  key: string;
  label: string;
  segments: BarSegmentDatum[];
}

const HATCH_PATTERN_ID = 'stats-bar-hatch';

/**
 * 막대/누적막대 SVG 직접 구현(FR-C-11, ui-spec §11-3 권고 — 신규 런타임 의존성 0건).
 * 개별 도형은 장식(`aria-hidden`)이며, 실제 접근성 정보는 `ChartFrame`의 `role="img" aria-label`과
 * 표 보기 토글이 담당한다(NFR-A1/A2).
 */
export function BarChartSvg({ data, height = 160 }: { data: BarDatum[]; height?: number }): JSX.Element {
  const barUnit = 40;
  const barWidth = 26;
  const width = Math.max(data.length * barUnit, barUnit);
  const maxValue = Math.max(
    1,
    ...data.map((d) => d.segments.reduce((sum, s) => sum + s.value, 0)),
  );
  const chartHeight = height - 20;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      height={height}
      role="presentation"
      aria-hidden="true"
      className="stats-bar-svg"
      preserveAspectRatio="none"
    >
      <defs>
        <pattern id={HATCH_PATTERN_ID} patternUnits="userSpaceOnUse" width="4" height="4" patternTransform="rotate(45)">
          <rect width="4" height="4" fill="transparent" />
          <line x1="0" y1="0" x2="0" y2="4" stroke="currentColor" strokeWidth="2" />
        </pattern>
      </defs>
      <line x1="0" y1={chartHeight} x2={width} y2={chartHeight} stroke="var(--color-border)" strokeWidth="1" />
      {data.map((bar, i) => {
        const x = i * barUnit + (barUnit - barWidth) / 2;
        let yOffset = chartHeight;
        return (
          <g key={bar.key}>
            {bar.segments.map((segment, si) => {
              const segHeight = (segment.value / maxValue) * chartHeight;
              const y = yOffset - segHeight;
              yOffset = y;
              return (
                <rect
                  key={si}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(segHeight, segment.value > 0 ? 1 : 0)}
                  className={`bar-segment ${segment.className}`}
                  fill={segment.pattern === 'hatch' ? `url(#${HATCH_PATTERN_ID})` : 'currentColor'}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
