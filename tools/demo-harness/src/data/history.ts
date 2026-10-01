// 과거 14일 대화 로그 계획(설계 §7.7 · FR-DH9-4) — 순수·결정적(무작위 0 · 멱등). 그래프용 시연 데이터이며 보고서·자막에 "시연용 과거 데이터"로 공개한다.
import { toKstDayBucket, toKstHourOfDay } from '@chat-bot/shared-types';

export interface HistoryIds {
  chatbotId: string;
  groupId: string;
  /** 의도 키 → { 의도 ID, 응답 노드 ID }. */
  intents: Record<string, { intentId: string; nodeId: string; answer: string }>;
  faqIds: string[];
  faqAnswers: string[];
  fallbackNodeId?: string;
}

export interface HistoryLogRow {
  chatbotId: string;
  channelType: 'WEB';
  sessionId: string;
  userMessage: string;
  botResponse: string;
  matchedIntentId: string | null;
  matchedNodeId: string | null;
  matchedFaqId: string | null;
  isAnswered: boolean;
  blockedByFilter: false;
  dayBucket: string;
  hourBucket: number;
  answeredByRag: false;
  createdAt: Date;
  groupId: string;
}

/** 의도별 자연스러운 질문 변형(개인정보 0). */
const NODE_QUESTIONS: Record<string, string[]> = {
  delivery: ['배송 언제 와요?', '택배 아직인가요', '운송장 번호 알려 주세요', '배송 조회가 안 돼요', '내 주문 어디쯤 왔어요'],
  refund: ['환불하고 싶어요', '반품하려면 어떻게 해요', '결제 취소 가능한가요', '환불은 며칠 걸려요', '교환 말고 환불로 바꿀래요'],
  hours: ['몇 시까지 상담해요?', '주말에도 상담되나요', '영업시간이 궁금해요', '점심시간에도 운영하나요'],
  change: ['배송지 바꾸고 싶어요', '옵션을 잘못 골랐어요', '주문 수정할 수 있나요', '수량을 바꾸고 싶어요'],
  member: ['비밀번호를 잊어버렸어요', '회원 탈퇴는 어떻게 해요', '연락처를 바꾸고 싶어요'],
  points: ['포인트 언제 들어오나요', '적립금 사용 방법 알려 주세요', '포인트 유효기간이 있나요'],
};
const FAQ_QUESTIONS: string[][] = [
  ['배송비는 얼마인가요?', '무료배송 기준이 궁금해요', '배송비가 얼마예요'],
  ['교환은 며칠 안에 가능한가요?', '교환 기간이 얼마나 되나요'],
  ['영수증은 어떻게 발급받나요?', '현금영수증은 어디서 받나요'],
];
const FALLBACK_QUESTIONS = [
  '오늘 날씨 어때요',
  '추천해 주실 선물 있나요',
  '사장님 성함이 뭐예요',
  '다른 쇼핑몰이랑 비교해 주세요',
  '재고가 언제 들어와요',
  '매장은 어디에 있나요',
  '이벤트 응모는 어떻게 하나요',
  '앱은 따로 있나요',
];
const FALLBACK_ANSWER = "죄송해요, 아직 배우지 못한 질문이에요. 다른 말로 물어봐 주시거나 '상담원 연결'이라고 입력해 주세요.";

/** 요일(0=월~6=일)별 하루 대화 수 — 평일이 주말보다 많다(고정 표). */
export const WEEKDAY_BASE = [34, 36, 33, 35, 38, 26, 22] as const;

/** mulberry32 — 시드가 같으면 항상 같은 수열(멱등). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 09~21시 위주의 시간대 가중 표. */
const HOUR_WEIGHTS: Array<[number, number]> = [
  [9, 6], [10, 9], [11, 10], [12, 7], [13, 8], [14, 9], [15, 9], [16, 8], [17, 8], [18, 7], [19, 6], [20, 5], [21, 3], [8, 1], [22, 1],
];

function pickHour(r: () => number): number {
  const total = HOUR_WEIGHTS.reduce((n, [, w]) => n + w, 0);
  let x = r() * total;
  for (const [h, w] of HOUR_WEIGHTS) {
    if ((x -= w) < 0) return h;
  }
  return 12;
}

export interface HistoryPlanOptions {
  /** 기준 시각(= 하네스 실행 시각). 기간은 이 시각의 KST 날짜 기준 T-14일 00:00 ~ 전날 23:59. */
  now: Date;
  days?: number;
  seed?: number;
}

/** 챗봇 A의 과거 대화 로그 행을 만든다. 응답 비율 약 85%(노드 70·FAQ 15·폴백 15 중 폴백만 미응답). */
export function planHistoricalLogs(ids: HistoryIds, opts: HistoryPlanOptions): HistoryLogRow[] {
  const days = opts.days ?? 14;
  const r = rng(opts.seed ?? 20261001);
  const rows: HistoryLogRow[] = [];
  const intentKeys = Object.keys(ids.intents);
  const kstTodayStartMs = Math.floor((opts.now.getTime() + 9 * 3_600_000) / 86_400_000) * 86_400_000 - 9 * 3_600_000; // 오늘 KST 00:00 (UTC ms)

  for (let back = days; back >= 1; back--) {
    const dayStart = kstTodayStartMs - back * 86_400_000;
    const weekday = (new Date(dayStart + 9 * 3_600_000).getUTCDay() + 6) % 7; // 0=월
    const count = WEEKDAY_BASE[weekday] + (back % 3) - 1;
    let seq = 0;
    let produced = 0;
    while (produced < count) {
      const turns = 1 + Math.floor(r() * 3); // 세션당 1~3턴
      const hour = pickHour(r);
      const minute = Math.floor(r() * 60);
      seq++;
      const sessionId = `demo-hist-${toKstDayBucket(new Date(dayStart)).replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
      for (let t = 0; t < turns && produced < count; t++) {
        const createdAt = new Date(dayStart + hour * 3_600_000 + (minute + t * 2) * 60_000 + Math.floor(r() * 50) * 1000);
        const roll = r();
        let row: Pick<HistoryLogRow, 'userMessage' | 'botResponse' | 'matchedIntentId' | 'matchedNodeId' | 'matchedFaqId' | 'isAnswered'>;
        if (roll < 0.7) {
          const key = intentKeys[Math.floor(r() * intentKeys.length)];
          const pool = NODE_QUESTIONS[key] ?? NODE_QUESTIONS.delivery;
          row = {
            userMessage: pool[Math.floor(r() * pool.length)],
            botResponse: ids.intents[key].answer,
            matchedIntentId: ids.intents[key].intentId,
            matchedNodeId: ids.intents[key].nodeId,
            matchedFaqId: null,
            isAnswered: true,
          };
        } else if (roll < 0.85) {
          const fi = Math.floor(r() * ids.faqIds.length);
          const pool = FAQ_QUESTIONS[fi] ?? FAQ_QUESTIONS[0];
          row = { userMessage: pool[Math.floor(r() * pool.length)], botResponse: ids.faqAnswers[fi] ?? '', matchedIntentId: null, matchedNodeId: null, matchedFaqId: ids.faqIds[fi], isAnswered: true };
        } else {
          row = {
            userMessage: FALLBACK_QUESTIONS[Math.floor(r() * FALLBACK_QUESTIONS.length)],
            botResponse: FALLBACK_ANSWER,
            matchedIntentId: null,
            matchedNodeId: ids.fallbackNodeId ?? null,
            matchedFaqId: null,
            isAnswered: false,
          };
        }
        rows.push({
          chatbotId: ids.chatbotId,
          channelType: 'WEB',
          sessionId,
          ...row,
          blockedByFilter: false,
          dayBucket: toKstDayBucket(createdAt),
          hourBucket: toKstHourOfDay(createdAt),
          answeredByRag: false,
          createdAt,
          groupId: ids.groupId,
        });
        produced++;
      }
    }
  }
  return rows;
}
