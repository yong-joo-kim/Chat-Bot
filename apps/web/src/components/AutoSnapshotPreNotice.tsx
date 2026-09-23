/**
 * 대량 작업 전 "자동으로 저장됩니다" 사전 고지(`version-history-ui-spec.md` §4.5).
 * E1(임포트 1단계)·E2(일괄 삭제 확인)·E3(증강 승인)·E4(학습현황 일괄 반영)에서 재사용한다.
 */
export function AutoSnapshotPreNotice({ text }: { text: string }): JSX.Element {
  return <p className="field-hint auto-snapshot-pre-notice">{text}</p>;
}
