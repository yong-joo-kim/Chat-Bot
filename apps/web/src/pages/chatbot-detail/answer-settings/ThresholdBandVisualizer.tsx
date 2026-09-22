import { MESSAGES } from '../../../constants/messages';

/**
 * 3구간(2단계 이관/되묻기/확정) 시각화 막대(ui-spec §4.1.1). 색상만으로 구간을 구분하지 않고
 * 패턴(해칭)이 다른 3개 구간 + 하단 텍스트 라벨을 병행한다(UIUX §1). `role="img"`로 감싸 요약
 * 문장을 `aria-label`로 100% 전달한다(`ChartFrame`의 "표 보기 대응" 원칙과 동일).
 */
export function ThresholdBandVisualizer({ accept, low, margin }: { accept: number; low: number; margin: number }): JSX.Element {
  const msg = MESSAGES.answerSettings.semantic.visualizer;
  const ariaLabel = msg.ariaLabel(low, accept, margin);
  const rejectWidth = Math.max(low, 0) * 100;
  const ambiguousWidth = Math.max(accept - low, 0) * 100;
  const acceptWidth = Math.max(1 - accept, 0) * 100;

  return (
    <div className="threshold-band-visualizer" role="img" aria-label={ariaLabel}>
      <div className="threshold-band-scale" aria-hidden="true">
        <span>0.00</span>
        <span>{low.toFixed(2)}</span>
        <span>{accept.toFixed(2)}</span>
        <span>1.00</span>
      </div>
      <div className="threshold-band-track" aria-hidden="true">
        <span className="threshold-band-segment threshold-band-segment--reject" style={{ width: `${rejectWidth}%` }} />
        <span className="threshold-band-segment threshold-band-segment--ambiguous" style={{ width: `${ambiguousWidth}%` }} />
        <span className="threshold-band-segment threshold-band-segment--accept" style={{ width: `${acceptWidth}%` }} />
      </div>
      <div className="threshold-band-labels" aria-hidden="true">
        <span>{msg.rejectLabel}</span>
        <span>{msg.ambiguousLabel}</span>
        <span>{msg.acceptLabel(margin)}</span>
      </div>
    </div>
  );
}
