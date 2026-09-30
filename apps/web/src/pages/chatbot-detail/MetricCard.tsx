/** 접속수/응답률/미응답률 공용 카드. [신규 No.36] srValue가 있으면 화면에는 value를, 스크린리더에는 srValue를 읽힌다(예: 분모 0의 "—"). 수치+레이블을 함께 표기해 색상만으로 좋고 나쁨을 전달하지 않는다(FR-2-13). */
export function MetricCard({ label, value, caption, srValue }: { label: string; value: string; caption: string; srValue?: string }): JSX.Element {
  return (
    <div className="metric-card">
      <p className="metric-card-label">{label}</p>
      <p className="metric-card-value">
        {srValue ? (
          <>
            <span aria-hidden="true">{value}</span>
            <span className="sr-only">{srValue}</span>
          </>
        ) : (
          value
        )}
      </p>
      <p className="metric-card-caption">{caption}</p>
    </div>
  );
}
