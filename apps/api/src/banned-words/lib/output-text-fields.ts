import type { DialogOutput } from '@chat-bot/shared-types';

type TextTransform = (text: string) => string;

/**
 * 아웃풋 14종의 사용자 노출 문자열 필드 화이트리스트(FR-12-40). `renderOutbound()`가 이미
 * 채널이 지원하는 부분집합으로 걸러내므로, 이 함수는 나머지 타입(`CONTEXT_FORM` 등 미실행
 * 아웃풋 포함)도 안전하게 받도록 `DialogOutput` 전체를 입력 타입으로 받는다. **[신규 No.46] 전
 * 타입을 명시 `case`로 다루고 `default`는 컴파일 시 망라 검출(`never`)만 한다** — 새 타입을
 * 추가하고 여기에 케이스를 안 넣으면 컴파일 오류가 난다(RM-3 · C-3, 모르는 타입을 조용히
 * 통과시키는 보안 결함 유형을 구조적으로 닫는다). `conversation/lib/conversation-log.ts`의
 * `buildBotResponseText()`(→`outputsToPlainText`)가 로그용으로 추출하는 필드의 **상위집합**이다 —
 * 응답에 마스킹이 누락되는 필드가 없도록 넓게 잡는다
 * (TEXT.text / CARD.title·description·altText·buttons[].label / IMAGE.altText / BUTTON.text·buttons[].label /
 * LINK.label / PHONE_CALL.label / CAROUSEL.text·cards[].title·description·altText·buttons[].label).
 * `PAUSE`와 비표시 6종은 사용자 노출 문자열이 없다.
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
    // [신규 No.46] `CAROUSEL` — 안내 문구·카드마다 제목·설명·대체 텍스트·버튼 라벨 전부 마스킹.
    case 'CAROUSEL':
      return {
        ...output,
        payload: {
          ...output.payload,
          ...(output.payload.text !== undefined ? { text: transform(output.payload.text) } : {}),
          cards: output.payload.cards.map((c) => ({
            ...c,
            title: transform(c.title),
            ...(c.description !== undefined ? { description: transform(c.description) } : {}),
            ...(c.altText !== undefined ? { altText: transform(c.altText) } : {}),
            ...(c.buttons !== undefined ? { buttons: c.buttons.map((b) => ({ ...b, label: transform(b.label) })) } : {}),
          })),
        },
      };
    case 'PAUSE':
    case 'CONTEXT_FORM':
    case 'DIALOG_MOVE':
    case 'SCENARIO':
    case 'SURVEY':
    case 'API_CONDITION':
    case 'WORKFLOW':
      // 사용자 노출 문자열이 없다(명시 case — FR-0-198 · RM-3 전 타입 명시).
      return output;
    default: {
      const unreachable: never = output;
      return unreachable;
    }
  }
}

export function maskOutputs(outputs: readonly DialogOutput[], transform: TextTransform): DialogOutput[] {
  return outputs.map((o) => maskOutputText(o, transform));
}
