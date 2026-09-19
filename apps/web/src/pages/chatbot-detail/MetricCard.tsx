/** 접속수/응답률/미응답률 공용 카드. 수치+레이블을 함께 표기해 색상만으로 좋고 나쁨을 전달하지 않는다(FR-2-13). */
export function MetricCard({ label, value, caption }: { label: string; value: string; caption: string }): JSX.Element {
  return (
    <div className="metric-card">
      <p className="metric-card-label">{label}</p>
      <p className="metric-card-value">{value}</p>
      <p className="metric-card-caption">{caption}</p>
    </div>
  );
}
