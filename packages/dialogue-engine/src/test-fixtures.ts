import type {
  ContextVariable,
  DialogNode,
  DialogOutput,
  DialogueBundle,
  FaqEntry,
  HomonymDictionary,
  Intent,
  Keyword,
} from '@chat-bot/shared-types';

/**
 * 엔진 단위 테스트 전용 fixture 빌더. 실제 서버/스키마 검증 없이 최소 필드만 채운다.
 * `DialogOutputSchema`(targetNodeId/contextVariableId 등) 다수가 `.uuid()` 검증을 요구하므로
 * fixture id는 항상 유효한 UUID 형식이어야 한다 — 접두사 문자열(`node-a` 등)은 사용하지 않는다.
 */

/** `crypto` 의존 없이(엔진 패키지는 Node 무의존, §7.1) 테스트용 UUID v4 형식 문자열을 생성한다. */
function generateUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.floor(Math.random() * 16);
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function uuid(_prefix: string): string {
  return generateUuid();
}

/** 스펙 파일에서 노드 간 상호 참조(DIALOG_MOVE 등)를 미리 만들어야 할 때 사용한다. */
export function randomId(): string {
  return generateUuid();
}

export function makeIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    id: uuid('intent'),
    chatbotId: 'bot-1',
    name: '테스트의도',
    examples: ['테스트 예문'],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeKeyword(overrides: Partial<Keyword> = {}): Keyword {
  return {
    id: uuid('keyword'),
    chatbotId: 'bot-1',
    name: '테스트키워드',
    synonyms: [],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeFaq(overrides: Partial<FaqEntry> = {}): FaqEntry {
  return {
    id: uuid('faq'),
    chatbotId: 'bot-1',
    category: 'FAQ',
    question: '테스트 질문',
    answer: '테스트 답변',
    altQuestions: [],
    enabled: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function textOutput(text: string): DialogOutput {
  return { type: 'TEXT', payload: { text } };
}

export function moveOutput(targetNodeId: string): DialogOutput {
  return { type: 'DIALOG_MOVE', payload: { targetNodeId } };
}

export function contextFormOutput(contextVariableId: string): DialogOutput {
  return { type: 'CONTEXT_FORM', payload: { contextVariableId } };
}

export function makeNode(overrides: Partial<DialogNode> = {}): DialogNode {
  return {
    id: uuid('node'),
    chatbotId: 'bot-1',
    name: '테스트노드',
    nodeType: 'NORMAL',
    matchMode: 'ANY',
    enabled: true,
    priority: 100,
    intentIds: [],
    keywordIds: [],
    outputs: [textOutput('기본 응답')],
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeContext(overrides: Partial<ContextVariable> = {}): ContextVariable {
  return {
    id: uuid('context'),
    chatbotId: 'bot-1',
    name: '테스트컨텍스트',
    slots: [
      { name: 'slot1', label: '슬롯1', prompt: '값을 입력해 주세요.', type: 'TEXT', required: true, maxRetry: 2 },
    ],
    cancelKeywords: ['취소', '그만', '처음으로'],
    sessionTimeoutMinutes: 30,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeHomonym(overrides: Partial<HomonymDictionary> = {}): HomonymDictionary {
  return {
    id: uuid('homonym'),
    chatbotId: 'bot-1',
    word: '배',
    meanings: [
      { label: '과일', contextHints: ['사과', '포도'] },
      { label: '선박', contextHints: ['항구', '운항'] },
    ],
    policy: 'ASK',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

export function makeBundle(overrides: Partial<DialogueBundle> = {}): DialogueBundle {
  return {
    intents: [],
    keywords: [],
    homonyms: [],
    dialogNodes: [],
    contexts: [],
    faqs: [],
    ...overrides,
  };
}
