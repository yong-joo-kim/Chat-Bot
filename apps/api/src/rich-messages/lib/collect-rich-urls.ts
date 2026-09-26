import type { DialogOutput } from '@chat-bot/shared-types';

/** 새 컴포넌트(캐러셀 카드 이미지·카드 LINK 버튼)만 대상 — 기존 CARD/IMAGE/LINK/BUTTON은 대상 밖(하위 호환). */
export interface CollectedRichUrl {
  url: string;
  field: string;
}

/**
 * [신규 No.46] 순수 함수 — DB·Nest 무의존. 노드 저장 검증(`assertRichUrlsAllowed`)과 설계 점검
 * (`rich-url-issues.ts`)이 함께 쓴다(`channel-rich-messages-설계.md` §2.1 · §9.3).
 */
export function collectRichUrls(outputs: readonly DialogOutput[]): CollectedRichUrl[] {
  const result: CollectedRichUrl[] = [];
  outputs.forEach((o, i) => {
    if (o.type !== 'CAROUSEL') return;
    o.payload.cards.forEach((c, j) => {
      if (c.imageUrl) result.push({ url: c.imageUrl, field: `outputs.${i}.payload.cards.${j}.imageUrl` });
      (c.buttons ?? []).forEach((b, k) => {
        if (b.action === 'LINK') result.push({ url: b.value, field: `outputs.${i}.payload.cards.${j}.buttons.${k}.value` });
      });
    });
  });
  return result;
}
