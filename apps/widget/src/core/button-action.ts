import { resolveButtonAction as resolveButtonActionShared } from '@chat-bot/shared-types/output-view';
import type { ButtonActionView } from '@chat-bot/shared-types/output-view';
import type { ButtonItem } from '@chat-bot/shared-types';

/**
 * 버튼 액션 판정(FR-W-6, §5.4) — `@chat-bot/shared-types/output-view`에 위임하고(DD-24),
 * 위젯 고유의 "서버 전송 여부" 판정만 추가한다. 시뮬레이터(`apps/web`)와 동일 판정 로직을 공유한다.
 */
export type { ButtonActionView };

export function resolveButtonAction(btn: ButtonItem): ButtonActionView {
  return resolveButtonActionShared(btn);
}

/** `LINK`는 클라이언트에서만 처리되고 서버로 전송하지 않는다(FR-11-25, AC-W-10). */
export function shouldSendToServer(action: ButtonActionView): boolean {
  return action.kind === 'MESSAGE' || action.kind === 'NODE';
}
