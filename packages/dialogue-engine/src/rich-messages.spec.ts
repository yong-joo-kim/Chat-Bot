import type { DialogOutput } from '@chat-bot/shared-types';
import { executeOutputs } from './outputs';
import { getOutgoingNodeRefs, validateDialogueDesign } from './design-validator';
import { resumeAfterApiCall } from './api-call';
import type { ApiCallSuspension } from './api-call';
import { apiConditionOutputV2, makeBundle, makeNode, randomId, textOutput } from './test-fixtures';

/**
 * [신규 No.46] 엔진 변경 닫힌 목록 EN-1~EN-6 검증(`channel-rich-messages-설계.md` §5·§18.1).
 * 엔진은 채널·강등·프로필을 모른다 — 여기서 검증하는 것은 ①`CAROUSEL` 표시용 비종결 통과
 * ②`{api.*}` 치환(카드 필드만·URL/값 비치환·1장→CARD·0장→제거) ③ BUTTON 재조립 스프레드 보존
 * (`display`) ④ 참조 수집·URL 점검 반영이다.
 */

function carouselOutput(overrides: {
  text?: string;
  cards?: Array<{ title: string; description?: string; imageUrl?: string; altText?: string; buttons?: Array<{ label: string; action: 'MESSAGE' | 'LINK' | 'NODE'; value: string }> }>;
} = {}): DialogOutput {
  return {
    type: 'CAROUSEL',
    payload: {
      version: 1,
      ...(overrides.text !== undefined ? { text: overrides.text } : {}),
      cards: overrides.cards ?? [{ title: '카드1' }, { title: '카드2' }],
    },
  } as unknown as DialogOutput;
}

function quickReplyButtonOutput(overrides: { text?: string; buttons?: Array<{ label: string; action: 'MESSAGE' | 'NODE'; value: string }> } = {}): DialogOutput {
  return {
    type: 'BUTTON',
    payload: {
      ...(overrides.text !== undefined ? { text: overrides.text } : {}),
      buttons: overrides.buttons ?? [{ label: '반품 문의', action: 'MESSAGE', value: '반품 문의' }],
      display: 'QUICK_REPLY',
    },
  } as unknown as DialogOutput;
}

describe('EN-1 — CAROUSEL은 표시용 비종결 아웃풋으로 통과한다', () => {
  it('apiVariables가 없으면 원본 객체 참조 그대로 통과한다(바이트 동일)', () => {
    const output = carouselOutput();
    const bundle = makeBundle();

    const result = executeOutputs([output], bundle, new Date());

    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0]).toEqual(output);
  });
});

describe('EN-4 — {api.*} 치환은 CAROUSEL의 텍스트 필드만 바꾼다(AC-L3-9 · AC-RM2-4)', () => {
  it('카드 제목·설명·버튼 라벨만 치환하고 이미지·LINK 주소·NODE 값은 그대로 둔다(카드 2장 이상 유지)', () => {
    const output = carouselOutput({
      text: '{api.greeting} 목록',
      cards: [
        {
          title: '{api.name1}',
          description: '설명 {api.name1}',
          imageUrl: 'https://img.example/{api.name1}.png',
          altText: '대체 텍스트',
          buttons: [{ label: '{api.name1} 보기', action: 'LINK', value: 'https://a.example/{api.name1}' }],
        },
        { title: '카드2' },
      ],
    });

    const result = executeOutputs([output], makeBundle(), new Date(), { apiVariables: { greeting: '안녕', name1: '요금제A' } });

    expect(result.outputs).toHaveLength(1);
    const carousel = result.outputs[0] as Extract<DialogOutput, { type: 'CAROUSEL' }>;
    expect(carousel.type).toBe('CAROUSEL');
    expect(carousel.payload.text).toBe('안녕 목록');
    expect(carousel.payload.cards[0].title).toBe('요금제A');
    expect(carousel.payload.cards[0].description).toBe('설명 요금제A');
    // URL·버튼 값은 비치환(AC-L3-9)
    expect(carousel.payload.cards[0].imageUrl).toBe('https://img.example/{api.name1}.png');
    expect(carousel.payload.cards[0].buttons?.[0].value).toBe('https://a.example/{api.name1}');
    expect(carousel.payload.cards[0].buttons?.[0].label).toBe('요금제A 보기');
    expect(carousel.payload.cards[1].title).toBe('카드2');
  });

  it('치환 후 1장만 남으면 CARD 1개(+ 안내 문구 TEXT)로 바뀐다(R-2 — 엔진 출력 스키마 유효 불변식)', () => {
    const output = carouselOutput({
      text: '안내문구',
      cards: [{ title: '{api.missing}' }, { title: '살아남는카드', description: '설명' }],
    });

    const result = executeOutputs([output], makeBundle(), new Date(), { apiVariables: {} });

    expect(result.outputs).toHaveLength(2);
    expect(result.outputs[0]).toEqual({ type: 'TEXT', payload: { text: '안내문구' } });
    expect(result.outputs[1].type).toBe('CARD');
    expect((result.outputs[1] as Extract<DialogOutput, { type: 'CARD' }>).payload.title).toBe('살아남는카드');
    expect(result.trace.some((t) => t.code === 'API_VALUE_DROPPED' && t.targetName?.includes('title'))).toBe(true);
  });

  it('치환 후 0장이면 아웃풋을 제거하고 API_VALUE_DROPPED trace를 남긴다', () => {
    const output = carouselOutput({ cards: [{ title: '{api.missing}' }, { title: '{api.missing2}' }] });

    const result = executeOutputs([output], makeBundle(), new Date(), { apiVariables: {} });

    // 캐러셀이 사라지고 EMPTY_OUTPUT 폴백 문구가 채워진다(엔진 최소 1건 보장 규약, FR-E-9).
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].type).toBe('TEXT');
    expect(result.trace.some((t) => t.code === 'API_VALUE_DROPPED' && t.targetName === 'CAROUSEL.cards')).toBe(true);
  });
});

describe('EN-3 — BUTTON 재조립은 스프레드로 display를 보존한다(ADR-0034 결함 유형 재발 방지 · FR-RM2-4)', () => {
  it('{api.*} 치환이 있는 턴에서도 바로연결(display=QUICK_REPLY)이 보존된다', () => {
    const output = quickReplyButtonOutput({ text: '{api.name}님, 다음을 선택해 주세요' });

    const result = executeOutputs([output], makeBundle(), new Date(), { apiVariables: { name: '홍길동' } });

    expect(result.outputs).toHaveLength(1);
    const button = result.outputs[0] as Extract<DialogOutput, { type: 'BUTTON' }>;
    expect(button.payload.text).toBe('홍길동님, 다음을 선택해 주세요');
    expect(button.payload.display).toBe('QUICK_REPLY');
  });

  it('resumeAfterApiCall 재진입 경로(v2 API_CONDITION 성공 분기)에서도 display가 보존된다(AC-RM2-4)', () => {
    const targetNode = makeNode({
      id: randomId(),
      name: '배송중 안내',
      outputs: [quickReplyButtonOutput({ text: '배송 중입니다: {api.status}' })],
    });
    const bundle = makeBundle({ dialogNodes: [targetNode] });
    const startOutputs = [
      apiConditionOutputV2({
        conditions: [{ path: 'data.status', operator: 'EQ', value: 'SHIPPED', nextNodeId: targetNode.id }],
        responseMappings: [{ name: 'status', path: 'data.status', required: true, maxLength: 50 }],
      }),
    ];

    const execResult = executeOutputs(startOutputs, bundle, new Date(), { sourceNodeId: 'node-x' });
    expect(execResult.suspended).toBeDefined();

    const suspension: ApiCallSuspension = {
      ...execResult.suspended!,
      resumeState: {
        input: '주문 조회',
        normalizedInput: '주문 조회',
        matchedNodeId: 'node-x',
        trace: [],
        carry: [],
        unsupported: [],
        hops: 0,
        hopLimit: 10,
        sessionFallback: null,
        existingSession: null,
      } as never,
    };

    const stub = {
      input: '주문 조회',
      normalizedInput: '주문 조회',
      outputs: [],
      nextSession: null,
      unsupportedOutputs: [],
      trace: [],
      nextState: { version: 1 as const, contextSession: null, pendingClarify: null },
      stateDiscarded: [],
      apiCall: suspension,
    };

    const resumed = resumeAfterApiCall(stub, { kind: 'SUCCESS', httpStatus: 200, json: { data: { status: 'SHIPPED' } } }, bundle, new Date());

    const button = resumed.outputs.find((o) => o.type === 'BUTTON') as Extract<DialogOutput, { type: 'BUTTON' }> | undefined;
    expect(button).toBeDefined();
    expect(button!.payload.text).toBe('배송 중입니다: SHIPPED');
    expect(button!.payload.display).toBe('QUICK_REPLY');
  });
});

describe('EN-5 — 캐러셀 카드 버튼의 NODE 참조는 기존 "버튼 → 노드" 참조와 같은 경로로 수집된다', () => {
  it('getOutgoingNodeRefs가 카드 버튼 NODE 대상을 buttonTargets에 포함한다', () => {
    const targetId = randomId();
    const node = makeNode({
      outputs: [carouselOutput({ cards: [{ title: '카드1', buttons: [{ label: '상담 연결', action: 'NODE', value: targetId }] }, { title: '카드2' }] })],
    });

    const refs = getOutgoingNodeRefs(node);

    expect(refs.buttonTargets).toContain(targetId);
  });

  it('참조 대상이 끊어지면 기존 CARD 버튼과 같은 BROKEN_REFERENCE 오류가 난다', () => {
    const node = makeNode({
      outputs: [carouselOutput({ cards: [{ title: '카드1', buttons: [{ label: '상담 연결', action: 'NODE', value: '00000000-0000-4000-8000-000000000000' }] }, { title: '카드2' }] })],
    });
    const bundle = makeBundle({ dialogNodes: [node] });

    const report = validateDialogueDesign(bundle, new Date());

    expect(report.issues.some((i) => i.code === 'BROKEN_REFERENCE' && i.severity === 'ERROR')).toBe(true);
  });
});

describe('EN-6 — URL 필드 {api.*} 토큰 점검이 캐러셀 이미지·LINK 버튼도 본다', () => {
  it('카드 imageUrl에 {api.*} 토큰이 있으면 API_TOKEN_IN_URL_FIELD 경고가 난다(치환되지 않는다는 안내)', () => {
    const node = makeNode({
      outputs: [carouselOutput({ cards: [{ title: '카드1', imageUrl: 'https://img.example/{api.token}.png', altText: '대체' }, { title: '카드2' }] })],
    });
    const bundle = makeBundle({ dialogNodes: [node] });

    const report = validateDialogueDesign(bundle, new Date());

    expect(report.issues.some((i) => i.code === 'API_TOKEN_IN_URL_FIELD' && i.severity === 'WARNING')).toBe(true);
  });
});

describe('기존 엔진 시험 무수정 통과 확인(AC-RM2-6) — 기존 타입 경로는 CAROUSEL 도입과 무관하다', () => {
  it('TEXT 하나뿐인 기존 노드는 이전과 동일하게 실행된다', () => {
    const node = makeNode({ outputs: [textOutput('안녕하세요')] });
    const bundle = makeBundle({ dialogNodes: [node] });

    const result = executeOutputs(node.outputs, bundle, new Date());

    expect(result.outputs).toEqual([textOutput('안녕하세요')]);
  });
});
