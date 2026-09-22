export interface AsyncJobProgressProps {
  /** 화면에 보이는 안내 문구(예: "생성 중입니다..."). */
  label: string;
  /** 0~100. 없으면 인디터미네이트(스피너만)로 표시한다. */
  progress?: number;
  /** 스크린리더 전용 안내(시작/진행/완료를 각각 다르게 줄 수 있다). 생략 시 `label`을 재사용한다. */
  ariaLiveText?: string;
}

/**
 * 비동기 작업 대기 패턴(UIUX §8) — 시각적 진행 표시 + `aria-live="polite"` 텍스트 안내를
 * 동시에 제공한다(애니메이션만으로 상태를 전달하지 않음). 상한 대기시간 초과 시의 정리 문구는
 * 호출부가 별도 배너로 표시한다(이 컴포넌트는 "진행 중" 상태 전용).
 */
export function AsyncJobProgress({ label, progress, ariaLiveText }: AsyncJobProgressProps): JSX.Element {
  return (
    <div className="async-job-progress" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
      {typeof progress === 'number' && (
        <progress className="async-job-progress-bar" value={progress} max={100}>
          {progress}%
        </progress>
      )}
      <span className="sr-only">{ariaLiveText ?? label}</span>
    </div>
  );
}
