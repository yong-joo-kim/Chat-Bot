import { MESSAGES } from '../constants/messages';

/**
 * [신규 No.46] "예상 모습(실제 규격 확인 전 추정)" 배지 — UIUX §1 추정 미리보기 표기 규칙을
 * 그대로 구현하는 공용 배지(RM-3 채널별 미리보기·RM-7 인박스 시뮬레이션이 공유). 색+아이콘+텍스트
 * 병기(색상 단독 금지, `channel-rich-messages-ui-spec.md` §2.2).
 */
export function AssumedPreviewBadge(): JSX.Element {
  return (
    <span className="assumed-preview-badge overlay-badge">
      <span aria-hidden="true">ⓘ</span> {MESSAGES.richMessages.assumedBadge}
    </span>
  );
}
