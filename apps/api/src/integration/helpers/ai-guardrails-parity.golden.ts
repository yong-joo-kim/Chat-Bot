import type { ParityRecord } from './ai-guardrails-parity';

/**
 * 바이트 동일 골든(v2 규칙 기준) — `GUARDRAILS_ENABLED=false`(가드레일 도입 전과 같은 동작) 실행 결과로 고정한 값이다. 2026-10-01 PM 결정(L-5)으로
 * 저장 마스킹이 독립 날짜(`2026-09-30`)를 계좌번호 후보에서 제외한다(생년월일 문맥은 예외 — 이 값에는 해당 없음). 규칙 변경 전(v1)에는
 * `날짜는 [계좌번호] 입니다.`였다. 저장 경로는 여전히 선택 인자 없이 기존 `maskPii`를 쓴다(AG-7).
 * 재생성 금지: 이 값이 바뀌면 공개 응답·저장 바이트가 달라진 것이다.
 */
export const PARITY_GOLDEN: ParityRecord[] = [
  {
    answeredByRag: false,
    guardrailStage: null,
    isAnswered: true,
    keys: ['messageId', 'outputs', 'state', 'stateReset'],
    message: '{KW} 문의',
    outputTexts: ['엔진 답변입니다.'],
    outputTypes: ['TEXT'],
    pending: false,
    poll: null,
    stateReset: false,
    status: 200,
    storedBotResponse: '엔진 답변입니다.',
    storedUserMessage: '{KW} 문의',
  },
  {
    answeredByRag: false,
    guardrailStage: null,
    isAnswered: false,
    keys: ['messageId', 'outputs', 'state', 'stateReset'],
    message: '연락처 010-1234-5678 주민 901231-1234567 입니다',
    outputTexts: ['죄송해요, 잘 이해하지 못했어요. 다른 방식으로 질문해 주시겠어요?'],
    outputTypes: ['TEXT'],
    pending: false,
    poll: null,
    stateReset: false,
    status: 200,
    storedBotResponse: '죄송해요, 잘 이해하지 못했어요. 다른 방식으로 질문해 주시겠어요?',
    storedUserMessage: '연락처 010-****-5678 주민 [주민등록번호] 입니다',
  },
  {
    answeredByRag: true,
    guardrailStage: null,
    isAnswered: true,
    keys: ['messageId', 'outputs', 'state', 'stateReset', 'pendingAnswer'],
    message: '문서에서 찾아줄 질문입니다',
    outputTexts: ['문서에서 찾아보고 있어요. 잠시만요.'],
    outputTypes: ['TEXT'],
    pending: true,
    poll: {
      keys: ['status', 'outputs', 'sources'],
      outputTexts: ['RAG 답변 본문입니다. 문의는 010-1234-5678 로, 날짜는 2026-09-30 입니다.'],
      status: 'READY',
    },
    stateReset: false,
    status: 200,
    storedBotResponse: 'RAG 답변 본문입니다. 문의는 010-****-5678 로, 날짜는 2026-09-30 입니다.',
    storedUserMessage: '문서에서 찾아줄 질문입니다',
  },
];
