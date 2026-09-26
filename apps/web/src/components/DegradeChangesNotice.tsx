import type { DegradeChange } from '@chat-bot/shared-types';
import { MESSAGES } from '../constants/messages';

function parseBeforeAfter(detail?: string): [number, number] | null {
  if (!detail) return null;
  const m = /^(\d+)→(\d+)$/.exec(detail);
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/** [신규 No.46] `DEGRADE_CHANGE_KINDS` 11종 → 한국어 문장 매핑(설계서 §7.1, ui-spec §7.2). */
function describeChange(change: DegradeChange): string {
  const msg = MESSAGES.richMessages;
  const ba = parseBeforeAfter(change.detail);
  switch (change.kind) {
    case 'CAROUSEL_TO_CARDS':
      // [코드 리뷰 R1 Medium] 서버가 "N→N"(무손실, EX-RM-12)을 보낸다 — N은 앞뒤가 같으므로 아무
      // 쪽이나 읽는다. detail이 없는 경우(정상 경로에서는 발생하지 않음)만 고정 문구로 폴백한다.
      return ba ? msg.changeCarouselToCards(ba[1]) : msg.changeCarouselToCardsGeneric;
    case 'CAROUSEL_TO_TEXT':
      return msg.changeCarouselToText;
    case 'CARDS_TRUNCATED':
      return ba ? msg.changeCardsTruncated(ba[0], ba[1]) : msg.changeCarouselToCardsGeneric;
    case 'BUTTONS_TRUNCATED':
      return ba ? msg.changeButtonsTruncated(ba[0], ba[1]) : msg.changeQuickReplyToButton;
    case 'QUICK_REPLY_TO_BUTTON':
      return msg.changeQuickReplyToButton;
    case 'BUTTON_TO_TEXT':
      return msg.changeButtonToText;
    case 'OUTPUT_TO_TEXT':
      return msg.changeOutputToText;
    case 'OUTPUT_REMOVED':
      return msg.changeOutputRemoved;
    case 'IMAGE_REMOVED':
      return msg.changeImageRemoved;
    case 'TEXT_TRUNCATED':
      return msg.changeTextTruncated;
    case 'ACTION_LOST':
      return msg.changeActionLost(change.detail ?? '');
    default: {
      const unreachable: never = change.kind;
      return unreachable;
    }
  }
}

/**
 * [신규 No.46] "바뀐 점" 문장 목록(RM-3 미리보기·RM-4 저장 경고·RM-7 인박스 시뮬레이션 공용).
 * 목록 0건이면 렌더하지 않는다(노이즈 방지, §2.2).
 */
export function DegradeChangesNotice({ changes }: { changes: DegradeChange[] }): JSX.Element | null {
  if (changes.length === 0) return null;
  const msg = MESSAGES.richMessages;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const c of changes) {
    const text = describeChange(c);
    if (seen.has(text)) continue;
    seen.add(text);
    lines.push(text);
  }
  return (
    <div className="degrade-changes-notice">
      <p className="field-label-static">{msg.changesTitle}</p>
      <ul>
        {lines.map((l, i) => (
          <li key={i}>{l}</li>
        ))}
      </ul>
    </div>
  );
}
