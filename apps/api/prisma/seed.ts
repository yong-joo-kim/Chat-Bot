// 개발/수동 검증용 시드(D-5, `docs/02-spec/chatbot-operations-설계.md` §10).
// 3트랙: A(대시보드 집계 검증용 100건 로그) / B(빈 상태 검증용 0건) / C(보관+과거로그).
// 멱등: 그룹/챗봇은 name·slug 기준 upsert, 대화로그는 매 실행마다 deleteMany 후 재생성한다.
// 자동 테스트(test-automation)는 이 시드가 아니라 자체 fixture를 쓰되 수치는 아래 표와 정렬한다.
import { PrismaClient } from '@prisma/client';
import { normalizeEmail, normalizeText } from '@chat-bot/shared-types';
import { hashPassword } from '../src/common/auth/lib/password-hash';

const prisma = new PrismaClient();

/**
 * 보안/이력(No.12~13) seed — ADMIN 1(부트스트랩) + EDITOR 1 + VIEWER 1(NFR-M5, 권한별 수동 검증용).
 * ADMIN만 `mustChangePassword=true`다 — 나머지 2명까지 강제하면 수동 검증이 매번 비밀번호 변경
 * 화면에 막혀 불가능해진다. 세션·감사로그는 만들지 않는다(실제 동작으로만 생성되어야 한다).
 */
async function upsertUser(params: { email: string; name: string; role: string; password: string; mustChangePassword: boolean }) {
  const email = normalizeEmail(params.email);
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return existing;
  const passwordHash = await hashPassword(params.password);
  return prisma.user.create({
    data: { email, name: params.name, role: params.role, passwordHash, mustChangePassword: params.mustChangePassword },
  });
}

async function seedUsers(): Promise<void> {
  const bootstrapEmail = process.env.BOOTSTRAP_ADMIN_EMAIL ?? 'admin@chat-bot.local';
  const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? 'ChangeMe!2026';

  await upsertUser({ email: bootstrapEmail, name: '시스템 관리자', role: 'ADMIN', password: bootstrapPassword, mustChangePassword: true });
  await upsertUser({ email: 'editor@chat-bot.local', name: '챗봇 편집자', role: 'EDITOR', password: 'Editor!2026', mustChangePassword: false });
  await upsertUser({ email: 'viewer@chat-bot.local', name: '운영 모니터', role: 'VIEWER', password: 'Viewer!2026', mustChangePassword: false });
}

/** 금지어 3~5건(NFR-M5) — 실제 비속어 대신 중립 문자열을 쓴다(저장소에 비속어 사전을 커밋하지 않는다). */
async function seedBannedWords(): Promise<void> {
  const defs = [
    { word: '테스트금지어1', matchType: 'CONTAINS', policy: 'BLOCK' },
    { word: '테스트금지어2', matchType: 'CONTAINS', policy: 'BLOCK' },
    { word: '테스트경고어1', matchType: 'CONTAINS', policy: 'WARN' },
    { word: '테스트완전일치어', matchType: 'EXACT', policy: 'WARN' },
  ];
  for (const def of defs) {
    const wordNormalized = normalizeText(def.word);
    const existing = await prisma.bannedWord.findUnique({ where: { wordNormalized } });
    if (existing) continue;
    await prisma.bannedWord.create({ data: { word: def.word, wordNormalized, matchType: def.matchType, policy: def.policy } });
  }
}

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

  await seedUsers();
  await seedBannedWords();

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

  // 대화 설계 재시딩 전, 조인/노드를 먼저 비운다 — intents/keywords/contexts가 onDelete:Restrict로
  // 참조되므로 삭제 순서를 지키지 않으면 재실행 시 P2003(FK 위반)으로 실패한다.
  await prisma.dialogNodeIntent.deleteMany({ where: { node: { chatbotId: supportBot.id } } });
  await prisma.dialogNodeKeyword.deleteMany({ where: { node: { chatbotId: supportBot.id } } });
  await prisma.dialogNode.deleteMany({ where: { chatbotId: supportBot.id } });

  await prisma.intent.deleteMany({ where: { chatbotId: supportBot.id } });
  const intentDefs = [
    {
      name: '배송조회',
      examples: ['제 주문 어디까지 왔어요?', '배송 조회하고 싶어요', '택배 언제 도착하나요', '주문번호 12345 배송상태 알려줘'],
    },
    { name: '환불문의', examples: ['환불 하고 싶어요', '환불 절차 알려주세요', '취소하고 환불 받을 수 있나요'] },
    { name: '영업시간문의', examples: ['영업시간이 궁금해요', '몇시까지 운영하나요'] },
    { name: '커피주문', examples: ['커피 주문할게요', '아메리카노 주문할래요'] },
    { name: '빈예문의도', examples: [] as string[] }, // EX-D-5: 예문 0개 — 설계 점검 WARNING 검증용
    // 품질/채널(No.10~11) — 동음이의어 "배" 되묻기 종결 회귀 시나리오(AC-E2-3~5) 최우선 검증용
    { name: '과일문의', examples: ['과일이 신선한가요?', '과일 종류가 뭐예요'] },
    { name: '선박문의', examples: ['선박 출항 시간 알려줘', '배편 예약하고 싶어요'] },
  ];
  const intents: Record<string, { id: string }> = {};
  for (const def of intentDefs) {
    const row = await prisma.intent.create({
      data: {
        chatbotId: supportBot.id,
        name: def.name,
        nameNormalized: normalizeText(def.name),
        examples: JSON.stringify(def.examples),
      },
    });
    intents[def.name] = row;
  }

  await prisma.keyword.deleteMany({ where: { chatbotId: supportBot.id } });
  const keywordDefs = [
    { name: '택배사', synonyms: ['우체국', 'CJ대한통운', '한진', '롯데'] },
    { name: '메뉴', synonyms: ['아메리카노', '라떼'] },
    { name: '사이즈', synonyms: ['톨', '그란데'] },
  ];
  const keywords: Record<string, { id: string }> = {};
  for (const def of keywordDefs) {
    const row = await prisma.keyword.create({
      data: {
        chatbotId: supportBot.id,
        name: def.name,
        nameNormalized: normalizeText(def.name),
        synonyms: JSON.stringify(def.synonyms),
      },
    });
    keywords[def.name] = row;
  }

  await prisma.homonymDictionary.deleteMany({ where: { chatbotId: supportBot.id } });
  await prisma.homonymDictionary.create({
    data: {
      chatbotId: supportBot.id,
      word: '배',
      wordNormalized: normalizeText('배'),
      // AC-E2-3~5 — 의미별 intentId 연결(품질/채널-설계.md §12). "신체"는 연결 의도 없이 남겨
      // "일부 의미만 연결"되는 실제 사례를 재현한다.
      meanings: JSON.stringify([
        { label: '과일', contextHints: ['사과', '포도'], intentId: intents['과일문의'].id },
        { label: '신체', contextHints: ['아프다', '통증'] },
        { label: '선박', contextHints: ['항구', '운항'], intentId: intents['선박문의'].id },
      ]),
      policy: 'ASK',
      clarifyPrompt: "어떤 '배'를 말씀하시는 건가요?",
    },
  });

  await prisma.contextVariable.deleteMany({ where: { chatbotId: supportBot.id } });
  const coffeeContext = await prisma.contextVariable.create({
    data: {
      chatbotId: supportBot.id,
      name: '커피주문',
      nameNormalized: normalizeText('커피주문'),
      slots: JSON.stringify([
        {
          // 슬롯명은 ContextSlotSchema 정규식(영문/숫자/언더스코어)을 따라야 한다 — 화면 표시는 label로 한다
          // (이번 품질/채널 시험 진행 중 발견된 대화설계 그룹 기존 seed 결함 수정, quality-channel-report.md 참고).
          name: 'menu',
          label: '메뉴',
          prompt: '메뉴를 선택해 주세요 (아메리카노/라떼).',
          type: 'CHOICE',
          required: true,
          choices: ['아메리카노', '라떼'],
          maxRetry: 2,
        },
        {
          name: 'size',
          label: '사이즈',
          prompt: '사이즈를 선택해 주세요 (톨/그란데).',
          type: 'CHOICE',
          required: true,
          choices: ['톨', '그란데'],
          maxRetry: 2,
        },
        {
          name: 'quantity',
          label: '수량',
          prompt: '수량을 입력해 주세요 (1~10).',
          type: 'NUMBER',
          required: true,
          validation: { min: 1, max: 10 },
          maxRetry: 2,
        },
      ]),
      completionMessage: '{menu} {size} {quantity}잔 주문을 확인했습니다!',
      sessionTimeoutMinutes: 30,
    },
  });

  const startNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '시작노드',
      nameNormalized: normalizeText('시작노드'),
      nodeType: 'START',
      priority: 100,
      outputs: JSON.stringify([{ type: 'TEXT', payload: { text: '안녕하세요! 무엇을 도와드릴까요?' } }]),
    },
  });

  const shippingNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '배송조회_응답',
      nameNormalized: normalizeText('배송조회_응답'),
      nodeType: 'NORMAL',
      priority: 100,
      outputs: JSON.stringify([
        { type: 'TEXT', payload: { text: '운송장 번호를 확인해 드릴게요.' } },
        {
          type: 'BUTTON',
          payload: { buttons: [{ label: '배송 조회', action: 'MESSAGE', value: '배송 조회' }, { label: '상담원 연결', action: 'MESSAGE', value: '상담원 연결' }] },
        },
        // 실행 미지원 아웃풋(SCENARIO/SURVEY/API_CONDITION) 배지 검증용(AC-5-7, EX-D-6)
        { type: 'SURVEY', payload: { surveyId: 'post-shipping-satisfaction' } },
      ]),
    },
  });
  await prisma.dialogNodeIntent.create({ data: { nodeId: shippingNode.id, intentId: intents['배송조회'].id } });

  const coffeeNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '커피주문_시작',
      nameNormalized: normalizeText('커피주문_시작'),
      nodeType: 'NORMAL',
      priority: 100,
      outputs: JSON.stringify([{ type: 'CONTEXT_FORM', payload: { contextVariableId: coffeeContext.id } }]),
    },
  });
  await prisma.dialogNodeIntent.create({ data: { nodeId: coffeeNode.id, intentId: intents['커피주문'].id } });

  // AC-E2-3~5 — 동음이의어 "배" 되묻기 종결 회귀 시나리오. 각 의미의 intentId 조건을 갖는 노드 2건.
  const fruitNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '과일_응답',
      nameNormalized: normalizeText('과일_응답'),
      nodeType: 'NORMAL',
      priority: 100,
      outputs: JSON.stringify([{ type: 'TEXT', payload: { text: '신선한 과일 배를 안내해 드릴게요.' } }]),
    },
  });
  await prisma.dialogNodeIntent.create({ data: { nodeId: fruitNode.id, intentId: intents['과일문의'].id } });

  const shipNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '선박_응답',
      nameNormalized: normalizeText('선박_응답'),
      nodeType: 'NORMAL',
      priority: 100,
      outputs: JSON.stringify([{ type: 'TEXT', payload: { text: '선박 출항 정보를 안내해 드릴게요.' } }]),
    },
  });
  await prisma.dialogNodeIntent.create({ data: { nodeId: shipNode.id, intentId: intents['선박문의'].id } });

  // AC-E2-1/AC-P-13 — 버튼 NODE 액션 진입점(resolveByNodeId) 회귀 시나리오. 이 노드의 BUTTON
  // 아웃풋을 누르면 서버로 `buttonAction:{kind:'NODE',nodeId}`가 전송되어 shippingNode로 직접 이동한다.
  const nodeButtonNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '바로가기_안내',
      nameNormalized: normalizeText('바로가기_안내'),
      nodeType: 'NORMAL',
      priority: 100,
      outputs: JSON.stringify([
        {
          type: 'BUTTON',
          payload: {
            text: '배송 조회 화면으로 바로 이동할까요?',
            buttons: [{ label: '배송 조회로 이동', action: 'NODE', value: shippingNode.id }],
          },
        },
      ]),
    },
  });
  await prisma.dialogNodeIntent.create({ data: { nodeId: nodeButtonNode.id, intentId: intents['빈예문의도'].id } });

  const fallbackNode = await prisma.dialogNode.create({
    data: {
      chatbotId: supportBot.id,
      name: '폴백노드',
      nameNormalized: normalizeText('폴백노드'),
      nodeType: 'FALLBACK',
      priority: 100,
      outputs: JSON.stringify([
        { type: 'TEXT', payload: { text: '죄송해요, 잘 이해하지 못했어요. 상담원 연결을 도와드릴까요?' } },
      ]),
    },
  });

  // AC-5-9: DIALOG_MOVE 순환(shippingNode ↔ coffeeNode) — 설계 점검 WARNING 재현용 추가 아웃풋
  await prisma.dialogNode.update({
    where: { id: shippingNode.id },
    data: {
      outputs: JSON.stringify([
        ...(JSON.parse(shippingNode.outputs) as unknown[]),
        { type: 'DIALOG_MOVE', payload: { targetNodeId: coffeeNode.id } },
      ]),
    },
  });
  await prisma.dialogNode.update({
    where: { id: coffeeNode.id },
    data: {
      outputs: JSON.stringify([
        ...(JSON.parse(coffeeNode.outputs) as unknown[]),
        { type: 'DIALOG_MOVE', payload: { targetNodeId: shippingNode.id } },
      ]),
    },
  });
  void startNode;
  void fallbackNode;

  await prisma.faqEntry.deleteMany({ where: { chatbotId: supportBot.id } });
  await prisma.faqEntry.createMany({
    data: [
      {
        chatbotId: supportBot.id,
        category: 'FAQ',
        question: '영업시간이 어떻게 되나요?',
        questionNormalized: normalizeText('영업시간이 어떻게 되나요?'),
        answer: '평일 09:00~18:00 운영합니다.',
        altQuestions: JSON.stringify(['영업시간 알려주세요']),
      },
      {
        chatbotId: supportBot.id,
        category: 'SMALL_TALK',
        question: '안녕',
        questionNormalized: normalizeText('안녕'),
        answer: '안녕하세요! 무엇을 도와드릴까요?',
      },
      {
        chatbotId: supportBot.id,
        category: 'SELF_SERVICE',
        question: '비밀번호를 잊어버렸어요',
        questionNormalized: normalizeText('비밀번호를 잊어버렸어요'),
        answer: "로그인 화면의 '비밀번호 찾기'를 이용해 주세요.",
        enabled: false, // AC-9-5: 비활성 배지 검증용
      },
      {
        chatbotId: supportBot.id,
        category: 'ERROR_RESPONSE',
        question: '이해하지 못했어요',
        questionNormalized: normalizeText('이해하지 못했어요'),
        answer: '죄송해요, 다시 한 번 다른 표현으로 말씀해 주시겠어요?',
      },
    ],
  });

  await prisma.channel.deleteMany({ where: { chatbotId: supportBot.id } });
  await prisma.channel.create({
    data: {
      chatbotId: supportBot.id,
      type: 'WEB',
      enabled: true,
      config: JSON.stringify({
        allowedOrigins: [], // 모든 출처 허용(개발 편의) — AC-P-1/AC-W 수동 검증용
        greetingMessage: '무엇을 도와드릴까요?',
        quickReplies: ['배송 조회', '환불 절차', '영업시간'],
        launcherPosition: 'RIGHT',
        showLauncher: true,
      }),
    },
  });
  // AC-11-3/AC-11-4, S-7 — CONFIG_ONLY 채널(활성화 불가) 화면 검증용
  await prisma.channel.create({
    data: {
      chatbotId: supportBot.id,
      type: 'KAKAOTALK',
      enabled: false,
      config: JSON.stringify({ note: '2분기 오픈빌더 심사 예정' }),
    },
  });

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

  // AC-11-1 — 채널 레코드 0건 챗봇(8종 전부 configured:false 검증용, 품질/채널-설계.md §12)
  const emptyChannelBot = await upsertChatbot({
    groupId: supportGroup.id,
    name: '채널 미설정 챗봇',
    slug: 'sample-empty-channel-bot',
    status: 'DRAFT',
    description: '채널 레코드 0건 — 채널 목록 빈 상태(전부 configured:false) 검증용',
  });
  await prisma.channel.deleteMany({ where: { chatbotId: emptyChannelBot.id } });
  await replaceConversationLogs(emptyChannelBot.id, []);

  // eslint-disable-next-line no-console
  console.log(
    `Seed 완료: support=${supportBot.id}(100 logs), empty=${emptyBot.id}(0 logs), archived=${archivedBot.id}(20 logs), emptyChannel=${emptyChannelBot.id}(0 channels)`,
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
