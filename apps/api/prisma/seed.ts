// 개발/수동 검증용 시드(D-5, `docs/02-spec/chatbot-operations-설계.md` §10).
// 3트랙: A(대시보드 집계 검증용 100건 로그) / B(빈 상태 검증용 0건) / C(보관+과거로그).
// 멱등: 그룹/챗봇은 name·slug 기준 upsert, 대화로그는 매 실행마다 deleteMany 후 재생성한다.
// 자동 테스트(test-automation)는 이 시드가 아니라 자체 fixture를 쓰되 수치는 아래 표와 정렬한다.
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEFAULT_SKIN = JSON.stringify({ primaryColor: '#4F46E5', headerTitle: '챗봇 상담' });

async function upsertGroup(name: string, description?: string) {
  const existing = await prisma.chatbotGroup.findFirst({ where: { name } });
  if (existing) {
    return prisma.chatbotGroup.update({ where: { id: existing.id }, data: { description } });
  }
  return prisma.chatbotGroup.create({ data: { name, description } });
}

async function upsertChatbot(params: {
  groupId: string;
  name: string;
  slug: string;
  status: string;
  description?: string;
}) {
  return prisma.chatbot.upsert({
    where: { slug: params.slug },
    update: {
      groupId: params.groupId,
      name: params.name,
      status: params.status,
      description: params.description,
    },
    create: {
      groupId: params.groupId,
      name: params.name,
      slug: params.slug,
      status: params.status,
      description: params.description,
      skin: DEFAULT_SKIN,
    },
  });
}

/** `now` 기준 상대 오프셋으로 시각을 계산한다 — 언제 실행하든 "최근 N일"에 재현성 있게 들어간다(AC-2-7). */
function offsetDate(now: Date, daysAgo: number, hoursAgo: number, minutesAgo: number): Date {
  const ms = now.getTime() - daysAgo * 24 * 60 * 60 * 1000 - hoursAgo * 60 * 60 * 1000 - minutesAgo * 60 * 1000;
  return new Date(ms);
}

interface LogSeed {
  userMessage: string;
  isAnswered: boolean;
  sessionId: string | null;
  createdAt: Date;
}

/**
 * 트랙 A(`sample-support-bot`) 대화로그 100건: 응답 90 / 미응답 10, sessionId 40종,
 * "배송 조회" 12건(공백 변형 1건 포함) · "환불 절차" 7건, 빈 문자열 1건(EX-2-3), 나머지 80건은 단일 발생 질문.
 * AC-2-1~AC-2-4, D-1(A안) 검증용.
 */
function buildTrackALogs(now: Date): LogSeed[] {
  const logs: LogSeed[] = [];
  let idx = 0;

  const pushLog = (userMessage: string, isAnswered: boolean): void => {
    const dayOffset = idx % 6; // 최근 7일 윈도 안에 여유 있게 들어오도록 6일 이내로 제한
    const hourOffset = (idx * 37) % 24;
    const minuteOffset = (idx * 13) % 60;
    const sessionIndex = (idx % 40) + 1;
    logs.push({
      userMessage,
      isAnswered,
      sessionId: `seed-session-${sessionIndex}`,
      createdAt: offsetDate(now, dayOffset, hourOffset, minuteOffset),
    });
    idx += 1;
  };

  for (let i = 0; i < 11; i += 1) pushLog('배송 조회', true);
  pushLog(' 배송  조회 ', true); // AC-2-4: 정규화 후 "배송 조회" 12건으로 합산되어야 한다

  for (let i = 0; i < 7; i += 1) pushLog('환불 절차', true);

  pushLog('', false); // EX-2-3: topQuestions 집계에서는 제외, 분모에는 포함

  for (let i = 1; i <= 71; i += 1) pushLog(`문의 사항 ${i}`, true);
  for (let i = 1; i <= 9; i += 1) pushLog(`처리 불가 문의 ${i}`, false);

  return logs;
}

/** 트랙 C(`archived-legacy-bot`) — 30일 이전 로그 20건(AC-1-11, AC-1-12, AC-2-10 검증용). */
function buildTrackCLogs(now: Date): LogSeed[] {
  const logs: LogSeed[] = [];
  for (let i = 0; i < 20; i += 1) {
    logs.push({
      userMessage: `과거 문의 ${i + 1}`,
      isAnswered: i % 4 !== 0,
      sessionId: i % 3 === 0 ? null : `legacy-session-${(i % 8) + 1}`,
      createdAt: offsetDate(now, 30 + (i % 10), i % 24, (i * 7) % 60),
    });
  }
  return logs;
}

async function replaceConversationLogs(chatbotId: string, logs: LogSeed[]): Promise<void> {
  await prisma.conversationLog.deleteMany({ where: { chatbotId } });
  if (logs.length === 0) return;
  await prisma.conversationLog.createMany({
    data: logs.map((log) => ({
      chatbotId,
      channelType: 'WEB',
      sessionId: log.sessionId ?? undefined,
      userMessage: log.userMessage,
      botResponse: log.isAnswered ? '안내해 드리겠습니다.' : '죄송합니다. 다시 문의해 주세요.',
      isAnswered: log.isAnswered,
      createdAt: log.createdAt,
    })),
  });
}

async function main(): Promise<void> {
  const now = new Date();

  const supportGroup = await upsertGroup('고객지원 그룹', '1차 개발 검증용 샘플 그룹');
  const archivedGroup = await upsertGroup('보관 그룹', '보관 처리된 챗봇을 모아두는 그룹');
  await upsertGroup('테스트 그룹', '빈 그룹 삭제(EX-1-4)·잔여 챗봇 그룹 삭제(AC-1-5) 검증용 — 챗봇 0개 유지');

  // 트랙 A: 대시보드 집계(응답률/미응답률/인기질문/접속수) 검증용
  const supportBot = await upsertChatbot({
    groupId: supportGroup.id,
    name: '샘플 고객지원 챗봇',
    slug: 'sample-support-bot',
    status: 'ACTIVE',
    description: 'Phase 1 대시보드 검증용 샘플 챗봇 — 대화로그 100건',
  });
  await replaceConversationLogs(supportBot.id, buildTrackALogs(now));

  await prisma.intent.deleteMany({ where: { chatbotId: supportBot.id } });
  await prisma.intent.create({
    data: {
      chatbotId: supportBot.id,
      name: '배송조회',
      examples: JSON.stringify([
        '제 주문 어디까지 왔어요?',
        '배송 조회하고 싶어요',
        '택배 언제 도착하나요',
        '주문번호 12345 배송상태 알려줘',
      ]),
    },
  });

  await prisma.faqEntry.deleteMany({ where: { chatbotId: supportBot.id } });
  await prisma.faqEntry.createMany({
    data: [
      {
        chatbotId: supportBot.id,
        category: 'SELF_SERVICE',
        question: '영업시간이 어떻게 되나요?',
        answer: '평일 09:00~18:00 운영합니다.',
      },
      {
        chatbotId: supportBot.id,
        category: 'SMALL_TALK',
        question: '안녕',
        answer: '안녕하세요! 무엇을 도와드릴까요?',
      },
    ],
  });

  await prisma.channel.deleteMany({ where: { chatbotId: supportBot.id } });
  await prisma.channel.create({ data: { chatbotId: supportBot.id, type: 'WEB', enabled: true } });

  // 트랙 B: 로그 0건 — 빈 상태(AC-2-5, AC-2-6) 및 DRAFT 임베드 주의문구(AC-4-10) 검증용
  const emptyBot = await upsertChatbot({
    groupId: supportGroup.id,
    name: '빈 대시보드 챗봇',
    slug: 'empty-dashboard-bot',
    status: 'DRAFT',
    description: '대화로그 0건 — 대시보드 빈 상태 검증용',
  });
  await replaceConversationLogs(emptyBot.id, []);

  // 트랙 C: 보관 + 과거 로그 — 영구삭제 409(AC-1-11), 편집 409(AC-1-12), 보관본 조회(AC-2-10) 검증용
  const archivedBot = await upsertChatbot({
    groupId: archivedGroup.id,
    name: '레거시 보관 챗봇',
    slug: 'archived-legacy-bot',
    status: 'ARCHIVED',
    description: '보관 처리된 레거시 챗봇 — 30일 이전 로그 20건 보유',
  });
  await replaceConversationLogs(archivedBot.id, buildTrackCLogs(now));

  // eslint-disable-next-line no-console
  console.log(
    `Seed 완료: support=${supportBot.id}(100 logs), empty=${emptyBot.id}(0 logs), archived=${archivedBot.id}(20 logs)`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
