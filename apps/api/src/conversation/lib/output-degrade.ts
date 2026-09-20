import type { DialogOutput, DialogOutputType } from '@chat-bot/shared-types';

/**
 * 채널이 지원하지 않는 아웃풋 타입을 텍스트로 격하한다(FR-11-19). WEB은 전 타입을 지원하므로
 * 이번 Phase에는 변환이 0건이지만, 경로는 항상 실행되어야 한다 — 새 채널이 추가될 때 격하 규칙이
 * 이미 동작 중인 상태여야 하기 때문이다(§8.2).
 */
export function degradeOutputs(outputs: DialogOutput[], supported: ReadonlySet<DialogOutputType>): DialogOutput[] {
  return outputs.map((o) => {
    if (supported.has(o.type)) return o;
    return { type: 'TEXT', payload: { text: degradedText(o) } };
  });
}

function degradedText(output: DialogOutput): string {
  switch (output.type) {
    case 'CARD':
      return `[카드] ${output.payload.title}`;
    case 'IMAGE':
      return `[이미지] ${output.payload.altText}`;
    case 'BUTTON':
      return output.payload.text ? `[버튼] ${output.payload.text}` : '[버튼]';
    case 'LINK':
      return `[링크] ${output.payload.label}`;
    case 'PHONE_CALL':
      return `[전화] ${output.payload.label}`;
    case 'PAUSE':
      return '';
    default:
      return '[지원하지 않는 응답]';
  }
}
