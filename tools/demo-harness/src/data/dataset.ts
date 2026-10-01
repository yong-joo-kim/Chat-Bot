// 시연 데이터셋 정의(설계 §7) — 가상 회사 "가온마켓". 고객에게 보일 문구에 "테스트·검증·D3-2" 같은 내부 표식을 쓰지 않는다(FR-DH3-6).
// 데이터는 TS 상수로 두어 시나리오 정의와 같은 커밋 대상이 된다. 개인정보는 없다.
import type { AccountKey } from '../scenario/types';

export const COMPANY = '가온마켓';

export interface AccountDef {
  key: 'admin1' | 'admin2' | 'agent' | 'editor' | 'viewer';
  email: string;
  name: string;
  role: 'ADMIN' | 'EDITOR' | 'VIEWER' | 'AGENT';
  /** 무대 창 이름표에 쓰는 표시(예: "관리자 김가온 (관리자)"). */
  badge: string;
}

export const ACCOUNTS: readonly AccountDef[] = [
  { key: 'admin1', email: 'admin1@demo.local', name: '관리자 김가온', role: 'ADMIN', badge: '관리자 김가온 (관리자)' },
  { key: 'admin2', email: 'admin2@demo.local', name: '관리자 이승인', role: 'ADMIN', badge: '관리자 이승인 (관리자)' },
  { key: 'agent', email: 'agent@demo.local', name: '상담원 박상담', role: 'AGENT', badge: '상담원 박상담 (상담원)' },
  { key: 'editor', email: 'editor@demo.local', name: '편집자 최편집', role: 'EDITOR', badge: '편집자 최편집 (편집자)' },
  { key: 'viewer', email: 'viewer@demo.local', name: '조회자 정조회', role: 'VIEWER', badge: '조회자 정조회 (조회자)' },
];

export function accountDef(key: AccountKey | AccountDef['key']): AccountDef {
  const a = ACCOUNTS.find((x) => x.key === key);
  if (!a) throw new Error(`알 수 없는 계정: ${key}`);
  return a;
}

export const GROUP_NAME = COMPANY;

// ── 챗봇 A "가온마켓 고객센터" ──────────────────────────────────────────────────────
export const BOT_A = {
  name: '가온마켓 고객센터',
  slug: 'gaon-support',
  description: '가온마켓(가상 쇼핑몰) 고객센터 챗봇입니다. 시연용입니다.',
  skin: { primaryColor: '#0F766E', headerTitle: '가온마켓 고객센터' },
  greeting: '안녕하세요, 가온마켓 고객센터입니다. 배송, 환불, 영업시간 등을 물어보세요.',
  fallback: "죄송해요, 아직 배우지 못한 질문이에요. 다른 말로 물어봐 주시거나 '상담원 연결'이라고 입력해 주세요.",
} as const;

export interface IntentDef {
  key: string;
  name: string;
  examples: string[];
  /** 이 의도에 연결할 응답 노드 문구. */
  answer: string;
  /** 응답 노드의 키워드 조건(키워드 키). */
  keywords?: string[];
}

export const INTENTS_A: readonly IntentDef[] = [
  {
    key: 'delivery',
    name: '배송조회',
    examples: ['배송 조회하고 싶어요', '택배 어디쯤 왔는지 알려 주세요', '주문한 상품 배송 상태 확인', '운송장 번호로 조회할래요', '물건이 아직 도착하지 않았어요'],
    answer: '주문하신 상품은 보통 결제 후 2~3일 안에 도착합니다. 마이페이지의 주문내역에서 운송장 번호로 배송 위치를 확인하실 수 있어요.',
    keywords: ['tracking'],
  },
  {
    key: 'refund',
    name: '환불문의',
    examples: ['환불하고 싶어요', '주문 취소하면 환불은 언제 되나요', '반품 접수는 어떻게 하나요', '결제한 금액을 돌려받고 싶어요'],
    answer: '상품을 받은 뒤 7일 안에 마이페이지에서 반품을 접수하시면, 상품 확인 후 3영업일 안에 결제 수단으로 환불해 드립니다.',
  },
  {
    key: 'hours',
    name: '영업시간',
    examples: ['영업시간 알려 주세요', '상담은 몇 시까지 하나요', '고객센터 운영 시간이 어떻게 되나요'],
    answer: '고객센터는 평일 오전 9시부터 오후 6시까지 운영합니다. 주말과 공휴일은 쉽니다.',
  },
  {
    key: 'change',
    name: '주문변경',
    examples: ['주문 내용을 바꾸고 싶어요', '배송지를 변경하고 싶어요', '주문한 옵션을 수정할래요'],
    answer: '상품이 발송되기 전에는 마이페이지의 주문내역에서 배송지와 옵션을 바꿀 수 있어요. 이미 발송된 주문은 변경이 어렵습니다.',
  },
  {
    key: 'member',
    name: '회원정보',
    examples: ['회원 정보를 수정하고 싶어요', '비밀번호를 바꾸고 싶어요', '가입한 이메일을 변경할래요'],
    answer: '마이페이지의 회원정보 수정에서 이름, 연락처, 비밀번호를 바꿀 수 있어요.',
  },
  {
    key: 'points',
    name: '포인트문의',
    examples: ['포인트는 언제 적립되나요', '적립금이 얼마나 남았는지 알고 싶어요'],
    answer: '포인트는 구매를 확정하고 7일 뒤에 적립되며, 적립일로부터 1년 동안 사용할 수 있어요.',
    keywords: ['point'],
  },
];

export const KEYWORDS_A = [
  { key: 'carrier', name: '택배사', synonyms: ['한진', '대한통운', '롯데택배', '우체국택배'] },
  { key: 'tracking', name: '운송장', synonyms: ['송장', '송장번호'] },
  { key: 'point', name: '포인트', synonyms: ['적립금'] },
] as const;

export interface FaqDef {
  question: string;
  answer: string;
  altQuestions: string[];
}

export const FAQS_A: readonly FaqDef[] = [
  { question: '배송비는 얼마인가요?', answer: '3만 원 이상 구매하시면 무료 배송이고, 그보다 적으면 배송비 3,000원이 부과됩니다.', altQuestions: ['배송비가 얼마예요', '무료배송 기준이 궁금해요'] },
  { question: '교환은 며칠 안에 가능한가요?', answer: '상품을 받은 날부터 7일 안에 교환을 신청하실 수 있어요. 단순 변심은 왕복 배송비가 부과됩니다.', altQuestions: ['교환 기간이 얼마나 되나요', '교환 가능한 기간 알려 주세요'] },
  { question: '영수증은 어떻게 발급받나요?', answer: '마이페이지의 주문내역에서 주문을 선택하고 영수증 보기를 누르면 출력할 수 있어요.', altQuestions: ['영수증 발급해 주세요', '현금영수증은 어디서 받나요'] },
];

/** 상담 연계 설정(②). */
export const HANDOFF_A = {
  enabled: true,
  cautionThreshold: 1,
  warningThreshold: 2,
  activeWindowMinutes: 10,
  userIdleMinutes: 10,
  agentNoReplyMinutes: 5,
  connectNotice: '상담원이 연결되었습니다. 잠시만 기다려 주세요.',
  endNotice: '상담이 종료되었습니다. 이용해 주셔서 감사합니다.',
  failNotice: '지금은 상담원 연결이 어렵습니다. 잠시 후 다시 시도해 주세요.',
} as const;

/** 힌트 패널의 "자주 쓰는 문장"은 고객 마지막 발화와 어휘가 겹칠 때만 제안된다(서버 규칙) — 첫 문장은 장면 2의 질문("통화")과 겹치게 썼다. */
export const CANNED_A = [
  { title: '통화 연결 안내', body: '통화를 원하시는군요, 상담원 박상담이 바로 도와드리겠습니다.', shortcut: '통화' },
  { title: '인사', body: '안녕하세요, 상담원 박상담입니다. 무엇을 도와드릴까요?', shortcut: '인사' },
  { title: '확인 중', body: '확인하는 동안 잠시만 기다려 주세요.', shortcut: '확인' },
  { title: '마무리', body: '더 도와드릴 일이 있으면 언제든 말씀해 주세요.', shortcut: '마무리' },
] as const;

/** 위험 응답 규칙(⑥, 3단계에서 장면 사용 — 데이터는 준비해 둔다). */
export const GUARDRAIL_A = {
  name: '약 복용 문의',
  category: 'MEDICAL_ADVICE',
  expressions: ['두 배로 먹어도', '복용량', '약을 더 먹어도'],
  matchType: 'CONTAINS',
  appliesTo: 'INBOUND',
  action: 'REPLACE',
  replacementText: '약 복용에 관한 내용은 안내해 드릴 수 없어요. 의사나 약사와 상담해 주세요.',
} as const;

/** 시나리오가 쓰는 고정 입력(설계 §7.9 보정 게이트와 같은 문장). */
export const SCENE_TEXT = {
  notYetArrived: '물건이 아직 안 왔어요',
  handoff1: '직원이랑 직접 통화하고 싶어요',
  handoff2: '사람이랑 통화할 수 있나요?',
  addedExample: '택배가 언제 오나요',
} as const;

// ── 검증 세트 "기본 응대 15문항"(④) ─────────────────────────────────────────────────
export type CaseKind = { kind: 'INTENT'; intentKey: string } | { kind: 'FAQ'; faqIndex: number };
export const TEST_SET_NAME = '기본 응대 15문항';
/** 의미 매칭이 꺼진 기준 실행에서 모두 통과해야 하는 14건(예문·FAQ 문장 그대로 + 가벼운 변형). */
export const BASELINE_CASES: ReadonlyArray<{ message: string; target: CaseKind }> = [
  { message: '배송 조회하고 싶어요', target: { kind: 'INTENT', intentKey: 'delivery' } },
  { message: '택배 어디쯤 왔는지 알려 주세요', target: { kind: 'INTENT', intentKey: 'delivery' } },
  { message: '환불하고 싶어요', target: { kind: 'INTENT', intentKey: 'refund' } },
  { message: '반품 접수는 어떻게 하나요', target: { kind: 'INTENT', intentKey: 'refund' } },
  { message: '영업시간 알려 주세요', target: { kind: 'INTENT', intentKey: 'hours' } },
  { message: '상담은 몇 시까지 하나요', target: { kind: 'INTENT', intentKey: 'hours' } },
  { message: '주문 내용을 바꾸고 싶어요', target: { kind: 'INTENT', intentKey: 'change' } },
  { message: '배송지를 변경하고 싶어요', target: { kind: 'INTENT', intentKey: 'change' } },
  { message: '회원 정보를 수정하고 싶어요', target: { kind: 'INTENT', intentKey: 'member' } },
  { message: '비밀번호를 바꾸고 싶어요', target: { kind: 'INTENT', intentKey: 'member' } },
  { message: '포인트는 언제 적립되나요', target: { kind: 'INTENT', intentKey: 'points' } },
  { message: '배송비는 얼마인가요?', target: { kind: 'FAQ', faqIndex: 0 } },
  { message: '교환은 며칠 안에 가능한가요?', target: { kind: 'FAQ', faqIndex: 1 } },
  { message: '영수증은 어떻게 발급받나요?', target: { kind: 'FAQ', faqIndex: 2 } },
];
/** 15번째 — 의미 매칭 꺼짐에서는 실패, 학습 반영 뒤 통과(④의 "1문항 개선"). */
export const IMPROVABLE_CASE = { message: SCENE_TEXT.notYetArrived, target: { kind: 'INTENT', intentKey: 'delivery' } } as const;

// ── 챗봇 B·C(⑤) ───────────────────────────────────────────────────────────────────
export const BOT_B = {
  name: '가온마켓 운영 통제 데모',
  slug: 'gaon-ops',
  greeting: '안녕하세요, 가온마켓 운영 통제 데모 챗봇입니다.',
  fallback: '죄송해요, 아직 배우지 못한 질문이에요.',
  intent: { name: '영업시간', examples: ['영업시간 알려 주세요', '운영 시간이 어떻게 되나요', '몇 시까지 상담하나요'] },
  answerV1: '평일 오전 9시~오후 6시에 상담합니다.',
  answerV2: '평일 오전 9시~오후 8시(연장 운영)에 상담합니다.',
  question: '영업시간 알려 주세요',
} as const;

export const BOT_C = {
  name: '가온마켓 야간 배포 데모',
  slug: 'gaon-night',
  greeting: '안녕하세요, 가온마켓 야간 배포 데모 챗봇입니다.',
  fallback: '죄송해요, 아직 배우지 못한 질문이에요.',
  intent: { name: '행사안내', examples: ['행사 안내 알려 주세요', '이번 달 행사가 뭐예요'] },
  answerV1: '10월 행사 안내입니다.',
  answerV2: '11월 행사 안내입니다.',
  answerV3: '12월 행사 안내입니다.',
} as const;

export const FIXTURE_CSV = 'utterances-demo.csv';
export const FIXTURE_CSV_ROWS = 200;
/** 사전 분석 조건(설계 §7.3 ⑦ 사전 분석 — 목표 묶음 6 · 최소 발화 5). */
export const PREANALYSIS_CONDITIONS = { targetClusterCount: 6, minClusterSize: 5, keywordCount: 10, nounsOnly: true, probe: { enabled: true, target: 'SERVING', scoreThreshold: null }, nameSuggest: false } as const;
