import type { OutputView } from '@chat-bot/shared-types/output-view';

export interface SplitQuickReplyResult {
  /** 칩으로 분리된 마지막 바로연결을 제외한 나머지 표시 아웃풋 — 앞선 바로연결은 `display`가
   * 제거된 일반 `BUTTON`으로 바뀐다(FR-RM2-3). */
  views: OutputView[];
  /** 이 턴의 마지막 바로연결(없으면 `null`) — 말풍선 아래 칩 묶음으로 렌더한다. */
  quickReply: Extract<OutputView, { type: 'BUTTON' }> | null;
}

/**
 * [신규 No.46] 한 턴의 `display==='QUICK_REPLY'` `BUTTON` 중 **마지막 1개**만 칩으로 분리한다
 * (EX-RM-11 — 한 턴 여러 바로연결은 마지막만 칩, 나머지는 말풍선 안 일반 버튼). 순수 함수 —
 * DOM·부수효과 0(`ui/renderers/quick-reply.ts`가 실제 렌더를 담당).
 */
export function splitQuickReply(views: readonly OutputView[]): SplitQuickReplyResult {
  const indexes: number[] = [];
  views.forEach((v, i) => {
    if (v.type === 'BUTTON' && v.payload.display === 'QUICK_REPLY') indexes.push(i);
  });
  if (indexes.length === 0) return { views: [...views], quickReply: null };

  const lastIndex = indexes[indexes.length - 1];
  const nextViews: OutputView[] = [];
  for (let i = 0; i < views.length; i += 1) {
    if (i === lastIndex) continue;
    const v = views[i];
    if (v.type === 'BUTTON' && v.payload.display === 'QUICK_REPLY') {
      const { display: _display, ...rest } = v.payload;
      nextViews.push({ type: 'BUTTON', payload: rest });
    } else {
      nextViews.push(v);
    }
  }
  return { views: nextViews, quickReply: views[lastIndex] as Extract<OutputView, { type: 'BUTTON' }> };
}
