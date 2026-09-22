import { MESSAGES } from '../../../constants/messages';

/**
 * 전체 재색인 실행(ui-spec §4.1.2). 확인 모달 없음(파괴적 동작이 아니라 재계산이므로,
 * `chatbot-operations`의 "대화 초기화"와 같은 판단). `chatbot:write` 권한이 없으면 부모가
 * 이 컴포넌트 자체를 렌더하지 않는다(버튼이 DOM에 없음 — disabled 아님).
 */
export function ReindexButton({ disabled, reindexing, onClick }: { disabled?: boolean; reindexing: boolean; onClick: () => void }): JSX.Element {
  const msg = MESSAGES.answerSettings.semantic;
  return (
    <button type="button" className="btn btn-secondary" disabled={disabled || reindexing} aria-disabled={disabled || reindexing} onClick={onClick}>
      {reindexing ? msg.reindexing : msg.reindexButton}
    </button>
  );
}
