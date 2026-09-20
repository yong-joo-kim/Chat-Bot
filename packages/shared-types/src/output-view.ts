import type { DialogOutput } from './dialogue';

/**
 * 아웃풋 표시/텍스트화 공유 모듈(DD-24, ADR-0012). **zod 무의존**이어야 한다 —
 * `apps/widget`이 gzip 100KB 예산 안에서 이 모듈을 값으로 import하기 때문이다.
 * `import type`만 사용해 zod를 끌어오지 않는다(타입 전용 import는 컴파일 시 지워진다).
 */

/** `http`/`https` 스킴만 안전하다고 판정한다(FR-W-11, NFR-S8). */
export function isSafeHttpUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

export interface ButtonActionView {
  kind: 'MESSAGE' | 'NODE' | 'LINK';
  label: string;
  text?: string;
  nodeId?: string;
  href?: string;
}

/** 버튼 action/value를 서버 전송 여부까지 포함해 판정한다(FR-W-6). */
export function resolveButtonAction(btn: { label: string; action: 'MESSAGE' | 'LINK' | 'NODE'; value: string }): ButtonActionView {
  if (btn.action === 'LINK') {
    return { kind: 'LINK', label: btn.label, href: isSafeHttpUrl(btn.value) ? btn.value : undefined };
  }
  if (btn.action === 'NODE') {
    return { kind: 'NODE', label: btn.label, nodeId: btn.value };
  }
  return { kind: 'MESSAGE', label: btn.label, text: btn.value };
}

/** 채널이 렌더 가능한 7종으로 좁힌 표시 모델(FR-W-5). 12종 중 미지원 3종·CONTEXT_FORM/DIALOG_MOVE는 제외한다. */
export type OutputView = Extract<DialogOutput, { type: 'TEXT' | 'CARD' | 'IMAGE' | 'BUTTON' | 'LINK' | 'PAUSE' | 'PHONE_CALL' }>;

const RENDERABLE_TYPES = new Set<OutputView['type']>(['TEXT', 'CARD', 'IMAGE', 'BUTTON', 'LINK', 'PAUSE', 'PHONE_CALL']);

export function toOutputViews(outputs: DialogOutput[]): OutputView[] {
  return outputs.filter((o): o is OutputView => RENDERABLE_TYPES.has(o.type as OutputView['type']));
}

/** `PAUSE` 누적 지연 계산 + 한 턴 5초 상한(FR-W-7). */
export function planPauseSchedule(views: OutputView[], maxTotalMs = 5000): number[] {
  let total = 0;
  return views.map((v) => {
    if (v.type !== 'PAUSE') return 0;
    const remaining = Math.max(0, maxTotalMs - total);
    const delay = Math.min(v.payload.durationMs, remaining);
    total += delay;
    return delay;
  });
}

/** 로그/요약용 텍스트 표현(FR-11-22). TEXT는 본문, 그 외는 `[타입] 요약` 형태, PAUSE는 생략. */
export function outputsToPlainText(outputs: DialogOutput[], maxLength = 2000): string {
  const lines: string[] = [];
  for (const o of outputs) {
    switch (o.type) {
      case 'TEXT':
        lines.push(o.payload.text);
        break;
      case 'CARD':
        lines.push(`[카드] ${o.payload.title}`);
        break;
      case 'IMAGE':
        lines.push(`[이미지] ${o.payload.altText}`);
        break;
      case 'BUTTON':
        lines.push(o.payload.text ? `[버튼] ${o.payload.text}` : '[버튼]');
        break;
      case 'LINK':
        lines.push(`[링크] ${o.payload.label}`);
        break;
      case 'PHONE_CALL':
        lines.push(`[전화] ${o.payload.label}`);
        break;
      case 'PAUSE':
        break;
      default:
        break;
    }
  }
  const joined = lines.join('\n');
  return joined.length > maxLength ? `${joined.slice(0, maxLength)}…` : joined;
}
