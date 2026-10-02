// [DT-2] 풀 투어 추가 데이터 정의(설계 §7) — 10분판 데이터(챗봇 A의 의도·예문)는 바꾸지 않고 풀 투어에서만 더한다.
// 가상 회사 "가온마켓". 고객에게 보일 문구에 "테스트·검증" 같은 내부 표식을 쓰지 않는다. 개인정보는 없다.
import type { VoiceSettingsInput } from '@chat-bot/shared-types';

/** 챗봇 A 음성 설정 — 기본 투어는 듣기만(입력 꺼짐), 음성 입력을 켜면 입력도 켠다. 말투는 안내형 · 미응답 사과형 · 환불 응답 노드 차분형. */
export function voiceSettingsA(inputEnabled: boolean, refundNodeId: string): VoiceSettingsInput {
  return {
    inputEnabled,
    ttsEnabled: true,
    autoReadToggleVisible: true,
    rateMultiplier: 1,
    defaultTone: 'INFORMATIVE',
    toneByKind: { UNANSWERED: 'APOLOGETIC' },
    nodeTones: [{ nodeId: refundNodeId, tone: 'CALM' }],
  };
}

/** 위험 응답 규칙 2번 "투자 권유 문의" — 기록만(MONITOR): 답을 막지 않고 남기기만 한다. DT-1 질문(S6-01·S6-03)에는 걸리지 않는다. */
export const GUARDRAIL_A_MONITOR = {
  name: '투자 권유 문의',
  category: 'FINANCIAL_ADVICE',
  expressions: ['주식 추천'],
  matchType: 'CONTAINS',
  appliesTo: 'INBOUND',
  action: 'MONITOR',
} as const;

/** S6-07 질문 — 기록만 규칙에 걸리지만 답은 정상(또는 폴백)으로 나온다. */
export const MONITOR_QUESTION = '포인트로 주식 추천도 받을 수 있나요?';

/** 합성 음성 문장(DX-3 정정 — small/cpu도 정확히 인식한 문장). 기대 의도 = 환불문의. 판정은 띄어쓰기·문장부호 정규화 + 핵심어. */
export const VOICE_PHRASE = {
  expected: '주문 취소하면 환불은 언제 되나요',
  keywords: ['환불', '언제'],
  /** 게이트 실패 시 리허설에서 바꿔 쓰는 대체 문장(K0에서 두 모델 모두 정확). */
  alternate: '반품하고 싶은데 환불은 며칠 걸리나요',
  intentName: '환불문의',
} as const;

/** 자동 읽기(SV-06)에 보내는 질문. */
export const AUTO_READ_QUESTION = '영업시간 알려 주세요';

/** 챗봇 D "가온마켓 주문 도우미"(⑨ 전용 · 가칭). */
export const BOT_D = {
  name: '가온마켓 주문 도우미',
  slug: 'gaon-order',
  description: '가온마켓(가상 쇼핑몰) 주문 도우미 챗봇입니다. 선제 안내 시연용입니다.',
  greeting: '안녕하세요, 가온마켓 주문 도우미입니다. 배송과 영업시간을 물어보세요.',
  fallback: '죄송해요, 아직 배우지 못한 질문이에요.',
  intents: {
    delivery: {
      name: '배송조회',
      examples: ['배송 조회하고 싶어요', '택배 어디쯤 왔는지 알려 주세요', '주문한 상품 배송 상태 확인'],
      answer: '주문하신 상품은 결제 후 2~3일 안에 도착합니다. 마이페이지의 주문내역에서 운송장 번호로 배송 위치를 확인하실 수 있어요.',
    },
    hours: {
      name: '영업시간',
      examples: ['영업시간 알려 주세요', '상담은 몇 시까지 하나요', '고객센터 운영 시간이 어떻게 되나요'],
      answer: '고객센터는 평일 오전 9시부터 오후 6시까지 운영합니다. 주말과 공휴일은 쉽니다.',
    },
  },
} as const;

/** 선제 안내 설정(허용 범위의 최소값 — 시연을 위해 짧게). */
export const PROACTIVE_SETTINGS_D = { enabled: true, maxPerSession: 1, minIntervalSec: 30, quietAfterUserMessageSec: 60 } as const;

/** 선제 안내 규칙(1) — 머문 시간 5초(허용 최소) · 버튼 2(MESSAGE). 용도 확인은 이용 도움 안내로 체크. */
export const PROACTIVE_RULE_D = {
  name: '배송 안내',
  trigger: { kind: 'PAGE_DWELL', pathInclude: ['/site'], pathExclude: [], dwellSec: 5 },
  text: '주문하신 상품의 배송 상황이 궁금하신가요?',
  buttons: [
    { label: '배송 조회', action: 'MESSAGE', value: '배송 조회하고 싶어요' },
    { label: '영업시간', action: 'MESSAGE', value: '영업시간 알려 주세요' },
  ],
  devices: ['DESKTOP'],
  purposeConfirmed: true,
} as const;

/** ④ 로컬 생성 사전 생성 대상(S4-03이 비활성인 풀 투어에서 ⑩이 쓰는 의도와 겹치지 않게 "회원정보"). */
export const PREPARED_GENERATION = { intentKey: 'member', count: 20 } as const;
/** ⑩ 실시간 생성 대상 의도. */
export const LIVE_GENERATION_INTENT_KEY = 'change';
