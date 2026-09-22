import { MESSAGES } from '../../../constants/messages';

/**
 * "위험 동작 부재 고지"(S-12, FR-N3-4) — 정적 텍스트이며 어떤 권한에서도 다른 동작으로
 * 이어지지 않는다(AC-N3-2). 화면 전체를 탐색해도 삭제·초기화·프롬프트 관리 UI가 없음을 명시한다.
 */
export function NoDestructiveActionsNotice(): JSX.Element {
  return (
    <p className="no-destructive-actions-notice">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.answerSettings.rag.noDestructiveNotice}
    </p>
  );
}
