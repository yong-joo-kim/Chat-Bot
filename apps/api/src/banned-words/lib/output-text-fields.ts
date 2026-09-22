import type { DialogOutput } from '@chat-bot/shared-types';

type TextTransform = (text: string) => string;

/**
 * 아웃풋 12종의 사용자 노출 문자열 필드 화이트리스트(FR-12-40). `renderOutbound()`가 이미
 * 채널이 지원하는 부분집합(WEB은 7종)으로 걸러내므로, 이 함수는 나머지 5종(`CONTEXT_FORM` 등
 * 미실행 아웃풋 포함)도 안전하게 받도록 `DialogOutput` 전체를 입력 타입으로 받되 `default` 분기로
 * 통과시킨다. `conversation/lib/conversation-log.ts`의 `buildBotResponseText()`(→`outputsToPlainText`)가
 * 로그용으로 추출하는 필드의 **상위집합**이다 — 응답에 마스킹이 누락되는 필드가 없도록 넓게 잡는다
 * (TEXT.text / CARD.title·description·altText·buttons[].label / IMAGE.altText / BUTTON.text·buttons[].label /
 * LINK.label / PHONE_CALL.label). `PAUSE`는 사용자 노출 문자열이 없다.
 */
export function maskOutputText(output: DialogOutput, transform: TextTransform): DialogOutput {
  switch (output.type) {
    case 'TEXT':
      return { ...output, payload: { ...output.payload, text: transform(output.payload.text) } };
    case 'CARD':
      return {
        ...output,
        payload: {
          ...output.payload,
          title: transform(output.payload.title),
          ...(output.payload.description !== undefined ? { description: transform(output.payload.description) } : {}),
          ...(output.payload.altText !== undefined ? { altText: transform(output.payload.altText) } : {}),
          ...(output.payload.buttons !== undefined
            ? { buttons: output.payload.buttons.map((b) => ({ ...b, label: transform(b.label) })) }
            : {}),
        },
      };
    case 'IMAGE':
      return { ...output, payload: { ...output.payload, altText: transform(output.payload.altText) } };
    case 'BUTTON':
      return {
        ...output,
        payload: {
          ...output.payload,
          ...(output.payload.text !== undefined ? { text: transform(output.payload.text) } : {}),
          buttons: output.payload.buttons.map((b) => ({ ...b, label: transform(b.label) })),
        },
      };
    case 'LINK':
      return { ...output, payload: { ...output.payload, label: transform(output.payload.label) } };
    case 'PHONE_CALL':
      return { ...output, payload: { ...output.payload, label: transform(output.payload.label) } };
    case 'PAUSE':
      return output;
    default:
      return output;
  }
}

export function maskOutputs(outputs: readonly DialogOutput[], transform: TextTransform): DialogOutput[] {
  return outputs.map((o) => maskOutputText(o, transform));
}
